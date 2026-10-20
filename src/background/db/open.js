(function initArchiveDatabaseModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { APP_DB_NAME, APP_DB_VERSION } = shared;

  const ARCHIVE_STORE_DEFINITIONS = Object.freeze({
    courses: { keyPath: "courseId", indexes: [["active", "active"], ["semester", "semester"], ["lastSeenAt", "lastSeenAt"]] },
    evidence: { keyPath: "evidenceId", indexes: [["courseId", "courseId"], ["source", "source"], ["courseSource", ["courseId", "source"]], ["lastSeenAt", "lastSeenAt"]] },
    evidenceRevisions: { keyPath: ["evidenceId", "revision"], indexes: [["evidenceId", "evidenceId"], ["courseId", "courseId"]] },
    entities: { keyPath: "entityId", indexes: [["courseId", "courseId"], ["entityType", "entityType"], ["courseEntityType", ["courseId", "entityType"]], ["status", "status"], ["dueAt", "dates.dueAt"], ["updatedAt", "updatedAt"]] },
    relationships: { keyPath: "relationshipId", indexes: [["courseId", "courseId"], ["fromId", "fromId"], ["toId", "toId"], ["type", "type"], ["fromType", ["fromId", "type"]], ["classification", "classification"]] },
    syncRuns: { keyPath: "syncRunId", indexes: [["startedAt", "startedAt"], ["status", "status"]] },
    changes: { keyPath: "changeId", indexes: [["syncRunId", "syncRunId"], ["courseId", "courseId"], ["type", "type"]] },
    activity: { keyPath: "activityId", indexes: [["timestamp", "timestamp"], ["operation", "operation"], ["status", "status"], ["courseId", "courseId"], ["correlationId", "correlationId"]] },
    syncJobs: { keyPath: "jobId", indexes: [["state", "state"], ["priority", "priority"], ["nextEligibleAt", "nextEligibleAt"], ["dedupeKey", "dedupeKey"], ["correlationId", "correlationId"]] },
    meta: { keyPath: "key", indexes: [] }
  });

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
  }

  function transactionResult(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    });
  }

  // The name is explicit: each D2L account has its own database, and the
  // original shared database keeps its original name (bound to its owner).
  function openArchiveDatabase(indexedDb = global.indexedDB, databaseName = APP_DB_NAME) {
    if (!indexedDb?.open) return Promise.reject(new Error("IndexedDB is unavailable."));
    return new Promise((resolve, reject) => {
      const request = indexedDb.open(databaseName, APP_DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const [name, definition] of Object.entries(ARCHIVE_STORE_DEFINITIONS)) {
          const store = database.objectStoreNames.contains(name)
            ? request.transaction.objectStore(name)
            : database.createObjectStore(name, { keyPath: definition.keyPath });
          for (const [indexName, keyPath] of definition.indexes) {
            if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, { unique: false });
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open archive database."));
      request.onblocked = () => reject(new Error("Archive database upgrade was blocked by another extension context."));
    });
  }

  function createIndexedDbArchiveAdapter(options = {}) {
    const openDatabase = options.openDatabase || (() => openArchiveDatabase(options.indexedDB || global.indexedDB, options.databaseName || APP_DB_NAME));
    return {
      async runTransaction(storeNames, mode, operation) {
        const database = await openDatabase();
        const transaction = database.transaction(storeNames, mode);
        const stores = Object.fromEntries(storeNames.map((name) => {
          const store = transaction.objectStore(name);
          return [name, {
            get: (key) => requestResult(store.get(key)),
            getAll: () => requestResult(store.getAll()),
            put: (value) => requestResult(store.put(value)),
            delete: (key) => requestResult(store.delete(key)),
            clear: () => requestResult(store.clear())
          }];
        }));
        try {
          const result = await operation(stores);
          await transactionResult(transaction);
          return result;
        } catch (error) {
          try { transaction.abort(); } catch {}
          throw error;
        }
      }
    };
  }

  Object.assign(background, { ARCHIVE_STORE_DEFINITIONS, requestResult, transactionResult, openArchiveDatabase, createIndexedDbArchiveAdapter });
})(globalThis);
