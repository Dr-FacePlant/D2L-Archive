// The text Ask has read from course files, kept in this browser (IndexedDB, never sent
// anywhere) so each file is read only once. One record per file and D2L account, stored
// under "accountId|file address": { state, text, pages, cut, label, name, readAt }.
// Only that account can list or clear its records. With no account it keeps nothing.
(function initDashboardAskFileTextStore(global) {
  const dash = global.D2LDashboard ||= {};

  const DB_NAME = "student-archive-file-text";
  const STORE = "texts";

  const settle = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const finished = (transaction) => new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });

  // Storage behind the store: getAll, put and remove by key.
  function indexedDbStore(indexedDB = global.indexedDB) {
    let opening = null;
    function database() {
      if (!indexedDB) return Promise.reject(new Error("This browser can't keep file text."));
      opening ||= new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { opening = null; reject(request.error); };
      });
      return opening;
    }
    return {
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

  function createFileTextStore(store = indexedDbStore()) {
    const clean = (accountId) => String(accountId || "").trim();

    // This account's records, by file address.
    async function all(accountId) {
      const account = clean(accountId);
      if (!account) return new Map();
      const records = (await store.getAll()).filter((record) => record.accountId === account);
      return new Map(records.map((record) => [record.fileKey, record]));
    }

    async function keep(accountId, fileKey, record) {
      const account = clean(accountId);
      if (!account || !fileKey) return;
      await store.put({ ...record, key: `${account}|${fileKey}`, accountId: account, fileKey });
    }

    async function clear(accountId) {
      const account = clean(accountId);
      if (!account) return;
      const keys = (await store.getAll()).filter((record) => record.accountId === account).map((record) => record.key);
      if (keys.length) await store.remove(keys);
    }

    return Object.freeze({ all, keep, clear });
  }

  Object.assign(dash, { createFileTextStore, askFileTexts: createFileTextStore() });
})(globalThis);
