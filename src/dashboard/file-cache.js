// Files opened in Preview are kept in this browser (IndexedDB, never sent
// anywhere), so opening one again is instant and works without D2L. The most
// recently opened 300 MB stay; older ones are dropped first.
//
// Every file belongs to one D2L account: it is stored under "accountId|url" and
// only that account can read, list or clear it. Files saved before accounts were
// separated (stored under the bare url) belong to the legacy archive owner only
// (scope.adoptLegacy) and move under that account's key the first time they are
// opened. With no account in the scope the cache does nothing.
(function initFileCache(global) {
  const dash = global.D2LDashboard ||= {};

  const DB_NAME = "student-archive-previews";
  const STORE = "files";
  const LIMIT_BYTES = 300 * 1024 * 1024;
  const MAX_FILE_BYTES = 100 * 1024 * 1024;

  const settle = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const finished = (transaction) => new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });

  // Storage behind the cache: get/put/delete by key plus getAll/clearKeys.
  function indexedDbStore(indexedDB = global.indexedDB) {
    let opening = null;
    function database() {
      if (!indexedDB) return Promise.reject(new Error("This browser can't keep files."));
      opening ||= new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "url" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { opening = null; reject(request.error); };
      });
      return opening;
    }
    return {
      async get(key) { return settle((await database()).transaction(STORE).objectStore(STORE).get(key)); },
      async getAll() { return settle((await database()).transaction(STORE).objectStore(STORE).getAll()); },
      async put(record) {
        const transaction = (await database()).transaction(STORE, "readwrite");
        transaction.objectStore(STORE).put(record);
        await finished(transaction);
      },
      async remove(keys) {
        const transaction = (await database()).transaction(STORE, "readwrite");
        for (const key of keys) transaction.objectStore(STORE).delete(key);
        await finished(transaction);
      }
    };
  }

  function createFileCache(store = indexedDbStore()) {
    const accountOf = (scope) => String(scope?.accountId || "").trim();
    const keyFor = (accountId, url) => `${accountId}|${url}`;
    const owns = (scope, record) => (record.accountId ? record.accountId === accountOf(scope) : scope.adoptLegacy === true);

    async function getFile(scope, url) {
      const accountId = accountOf(scope);
      if (!accountId || !url) return null;
      const key = keyFor(accountId, url);
      let record = await store.get(key);
      if (!record && scope.adoptLegacy === true) {
        const legacy = await store.get(url);
        if (legacy?.blob && !legacy.accountId) {
          record = { ...legacy, url: key, sourceUrl: url, accountId };
          await store.put(record);
          await store.remove([url]);
        }
      }
      if (!record?.blob) return null;
      store.put({ ...record, usedAt: Date.now() }).catch(() => {});
      return record.blob;
    }

    async function trim() {
      const records = await store.getAll();
      records.sort((a, b) => b.usedAt - a.usedAt);
      let total = 0;
      const drop = [];
      for (const record of records) {
        total += record.size || 0;
        if (total > LIMIT_BYTES) drop.push(record.url);
      }
      if (drop.length) await store.remove(drop);
    }

    async function keepFile(scope, url, blob) {
      const accountId = accountOf(scope);
      if (!accountId || !url || !blob || blob.size > MAX_FILE_BYTES) return;
      await store.put({ url: keyFor(accountId, url), sourceUrl: url, accountId, blob, type: blob.type, size: blob.size, usedAt: Date.now() });
      await trim();
    }

    // Settings > Storage: how many of this account's files are kept, and a way to drop them.
    async function usage(scope) {
      if (!accountOf(scope)) return { count: 0, bytes: 0 };
      const records = (await store.getAll()).filter((record) => owns(scope, record));
      return { count: records.length, bytes: records.reduce((sum, record) => sum + (record.size || 0), 0) };
    }

    async function clear(scope) {
      if (!accountOf(scope)) return;
      const keys = (await store.getAll()).filter((record) => owns(scope, record)).map((record) => record.url);
      if (keys.length) await store.remove(keys);
    }

    return Object.freeze({ getFile, keepFile, usage, clear });
  }

  Object.assign(dash, { createFileCache, fileCache: createFileCache() });
})(globalThis);
