/* The Handyman Accountancy v233 - non-destructive IndexedDB foundation.
   This module is an isolated storage layer. It does not change app persistence
   automatically and never deletes or modifies legacy LocalStorage values.
*/
(function () {
  "use strict";
  const DB_NAME = "the_handyman_accountancy_test226";
  const DB_VERSION = 4;
  const PREFIX = "tha_test226_";
  const LEGACY_KEYS = [
    "tha_test226_accounting_v1",
    "tha_test226_contracts_v1",
    "tha_test226_projects_v1",
    "tha_test226_factory_reset_recovery_v1"
  ];
  const STORES = ["legacySnapshots", "customers", "projects", "invoices", "contracts",
    "accountingEntries", "projectReceipts", "projectExpenses", "workers", "partners",
    "contractors", "companies", "companyJobs", "customExpenseCategories",
    "thirdPartyTransactions", "accountingSettings", "projectMetadata", "auditLog", "recordOrder"];
  const KV_STORE = "kv";

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB is unavailable"));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: "id" });
            if (name === "legacySnapshots") store.createIndex("legacyKey", "legacyKey", { unique: false });
          }
        }
        if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE, { keyPath: "key" });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error("Could not open IndexedDB"));
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another open tab"));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
  }

  function enumerateLegacyKeys() {
    const found = new Set(LEGACY_KEYS);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) found.add(key);
    }
    return [...found].sort();
  }

  async function get(key) {
    const db = await openDatabase();
    try {
      const tx = db.transaction([KV_STORE], "readonly");
      const record = await requestResult(tx.objectStore(KV_STORE).get(String(key)));
      return record ? record.value : null;
    } finally { db.close(); }
  }

  async function set(key, value) {
    const db = await openDatabase();
    try {
      const normalizedKey = String(key);
      const normalizedValue = String(value);
      const tx = db.transaction([KV_STORE], "readwrite");
      tx.objectStore(KV_STORE).put({
        key: normalizedKey,
        value: normalizedValue,
        byteLength: new Blob([normalizedValue]).size,
        updatedAt: new Date().toISOString()
      });
      await transactionDone(tx);
      const verifyTx = db.transaction([KV_STORE], "readonly");
      const saved = await requestResult(verifyTx.objectStore(KV_STORE).get(normalizedKey));
      if (!saved || saved.value !== normalizedValue) throw new Error("IndexedDB write verification failed for " + normalizedKey);
      return true;
    } finally { db.close(); }
  }

  async function remove(key) {
    const db = await openDatabase();
    try {
      const tx = db.transaction([KV_STORE], "readwrite");
      tx.objectStore(KV_STORE).delete(String(key));
      await transactionDone(tx);
      const verifyTx = db.transaction([KV_STORE], "readonly");
      const saved = await requestResult(verifyTx.objectStore(KV_STORE).get(String(key)));
      if (saved) throw new Error("IndexedDB delete verification failed for " + key);
      return true;
    } finally { db.close(); }
  }

  async function keys() {
    const db = await openDatabase();
    try {
      const tx = db.transaction([KV_STORE], "readonly");
      return await requestResult(tx.objectStore(KV_STORE).getAllKeys());
    } finally { db.close(); }
  }

  async function snapshotLegacyData() {
    const db = await openDatabase();
    const snapshots = [];
    try {
      for (const key of enumerateLegacyKeys()) {
        const raw = localStorage.getItem(key);
        if (raw === null) {
          snapshots.push({ legacyKey: key, present: false, byteLength: 0, validJson: null });
          continue;
        }
        let validJson = true;
        try { JSON.parse(raw); } catch (_) { validJson = false; }
        const record = {
          id: "snapshot:" + key,
          legacyKey: key,
          present: true,
          raw,
          byteLength: new Blob([raw]).size,
          validJson,
          capturedAt: new Date().toISOString()
        };
        const tx = db.transaction(["legacySnapshots"], "readwrite");
        tx.objectStore("legacySnapshots").put(record);
        await transactionDone(tx);
        const readTx = db.transaction(["legacySnapshots"], "readonly");
        const stored = await requestResult(readTx.objectStore("legacySnapshots").get(record.id));
        if (!stored || stored.raw !== raw) throw new Error("Snapshot verification failed for " + key);
        snapshots.push({ legacyKey: key, present: true, byteLength: record.byteLength, validJson });
      }
      return { ok: true, database: DB_NAME, schemaVersion: DB_VERSION, snapshots };
    } finally { db.close(); }
  }

  async function migrateLegacyData() {
    const snapshot = await snapshotLegacyData();
    const migrated = [];
    for (const item of snapshot.snapshots) {
      if (!item.present) continue;
      const raw = localStorage.getItem(item.legacyKey);
      if (raw === null) throw new Error("Legacy value changed during migration: " + item.legacyKey);
      await set(item.legacyKey, raw);
      const copied = await get(item.legacyKey);
      if (copied !== raw) throw new Error("Migration verification failed for " + item.legacyKey);
      migrated.push({ key: item.legacyKey, byteLength: item.byteLength, validJson: item.validJson });
    }
    return { ok: true, nonDestructive: true, migratedCount: migrated.length, migrated };
  }

  async function verifyMigration() {
    const results = [];
    for (const key of enumerateLegacyKeys()) {
      const source = localStorage.getItem(key);
      if (source === null) continue;
      const target = await get(key);
      results.push({ key, matches: target === source, sourceBytes: new Blob([source]).size,
        indexedDbBytes: target === null ? 0 : new Blob([target]).size });
    }
    return { ok: results.every(x => x.matches), checked: results.length,
      mismatches: results.filter(x => !x.matches), results };
  }


  async function selfTest() {
    const testKey = "__tha_idb_self_test__:" + Date.now() + ":" + Math.random().toString(36).slice(2);
    const testValue = JSON.stringify({ marker: "THA-IDB-SELF-TEST", createdAt: new Date().toISOString(), payload: "read-write-verify-delete" });
    let writeVerified = false, readVerified = false, listed = false, deleteVerified = false;
    try {
      await set(testKey, testValue);
      writeVerified = true;
      readVerified = (await get(testKey)) === testValue;
      listed = (await keys()).includes(testKey);
      if (!readVerified || !listed) throw new Error("IndexedDB read/list verification failed");
      await remove(testKey);
      deleteVerified = (await get(testKey)) === null && !(await keys()).includes(testKey);
      if (!deleteVerified) throw new Error("IndexedDB delete verification failed");
      return { ok: true, database: DB_NAME, schemaVersion: DB_VERSION,
        checks: { writeVerified, readVerified, listed, deleteVerified },
        legacyDataChanged: false };
    } catch (error) {
      try { await remove(testKey); } catch (_) {}
      return { ok: false, database: DB_NAME, schemaVersion: DB_VERSION,
        checks: { writeVerified, readVerified, listed, deleteVerified },
        legacyDataChanged: false, error: String(error && error.message || error) };
    }
  }

  async function status() {
    const db = await openDatabase();
    try {
      const counts = {};
      for (const name of [...STORES, KV_STORE]) {
        const tx = db.transaction([name], "readonly");
        counts[name] = await requestResult(tx.objectStore(name).count());
      }
      return { ok: true, database: DB_NAME, schemaVersion: DB_VERSION, stores: counts };
    } finally { db.close(); }
  }

  window.HandymanStorageFoundation = Object.freeze({
    openDatabase, get, set, remove, keys, snapshotLegacyData, migrateLegacyData,
    verifyMigration, selfTest, status, legacyKeys: LEGACY_KEYS.slice(),
    stores: [...STORES, KV_STORE], databaseName: DB_NAME, schemaVersion: DB_VERSION
  });
})();
