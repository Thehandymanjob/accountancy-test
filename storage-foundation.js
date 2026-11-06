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


  function assertRecordStore(name) {
    if (!STORES.includes(name) || name === "legacySnapshots") {
      throw new Error("Unsupported operational IndexedDB store: " + name);
    }
    return name;
  }

  function validateRecord(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("IndexedDB record must be an object.");
    }
    if (typeof record.id !== "string" && !(typeof record.id === "number" && Number.isFinite(record.id))) {
      throw new Error("IndexedDB record requires a non-empty string or finite numeric id.");
    }
    if (String(record.id).trim() === "") throw new Error("IndexedDB record id cannot be empty.");
    return record;
  }

  async function putRecord(storeName, record) {
    assertRecordStore(storeName);
    validateRecord(record);
    const db = await openDatabase();
    try {
      const tx = db.transaction([storeName], "readwrite");
      const done = transactionDone(tx);
      tx.objectStore(storeName).put(record);
      await done;
      const saved = await getRecord(storeName, record.id);
      if (!saved || saved.id !== record.id || JSON.stringify(saved) !== JSON.stringify(record)) {
        throw new Error("IndexedDB record write verification failed for " + storeName + "/" + record.id);
      }
      return { ok: true, store: storeName, id: record.id };
    } finally { db.close(); }
  }

  async function getRecord(storeName, id) {
    assertRecordStore(storeName);
    const db = await openDatabase();
    try {
      const tx = db.transaction([storeName], "readonly");
      const done = transactionDone(tx);
      const result = await requestResult(tx.objectStore(storeName).get(id));
      await done;
      return result || null;
    } finally { db.close(); }
  }

  async function getAllRecords(storeName) {
    assertRecordStore(storeName);
    const db = await openDatabase();
    try {
      const tx = db.transaction([storeName], "readonly");
      const done = transactionDone(tx);
      const result = await requestResult(tx.objectStore(storeName).getAll());
      await done;
      return result;
    } finally { db.close(); }
  }

  async function countRecords(storeName) {
    assertRecordStore(storeName);
    const db = await openDatabase();
    try {
      const tx = db.transaction([storeName], "readonly");
      const done = transactionDone(tx);
      const count = await requestResult(tx.objectStore(storeName).count());
      await done;
      return count;
    } finally { db.close(); }
  }

  async function deleteRecord(storeName, id) {
    assertRecordStore(storeName);
    const db = await openDatabase();
    try {
      const tx = db.transaction([storeName], "readwrite");
      const done = transactionDone(tx);
      tx.objectStore(storeName).delete(id);
      await done;
      const remaining = await getRecord(storeName, id);
      if (remaining !== null) throw new Error("IndexedDB record delete verification failed for " + storeName + "/" + id);
      return { ok: true, store: storeName, id };
    } finally { db.close(); }
  }

  async function bulkPutRecords(storeName, records) {
    assertRecordStore(storeName);
    if (!Array.isArray(records)) throw new Error("Bulk IndexedDB write requires an array.");
    const ids = new Set();
    for (const record of records) {
      validateRecord(record);
      const id = String(record.id);
      if (ids.has(id)) throw new Error("Duplicate record id in bulk write: " + id);
      ids.add(id);
    }
    const db = await openDatabase();
    try {
      const tx = db.transaction([storeName], "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore(storeName);
      for (const record of records) store.put(record);
      await done;
      const verified = await Promise.all(records.map(record => getRecord(storeName, record.id)));
      for (let i = 0; i < records.length; i++) {
        if (!verified[i] || JSON.stringify(verified[i]) !== JSON.stringify(records[i])) {
          throw new Error("IndexedDB bulk write verification failed for " + storeName + "/" + records[i].id);
        }
      }
      return { ok: true, store: storeName, written: records.length };
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
    const alreadyMatched = [];
    const conflicts = [];
    const invalid = [];
    for (const item of snapshot.snapshots) {
      if (!item.present) continue;
      const raw = localStorage.getItem(item.legacyKey);
      if (raw === null) throw new Error("Legacy value changed during migration: " + item.legacyKey);
      if (!item.validJson) {
        invalid.push({ key: item.legacyKey, byteLength: item.byteLength });
        continue;
      }
      // Never overwrite an existing IndexedDB value during migration. A mismatch
      // is a recovery conflict and must be resolved explicitly, not guessed.
      const existing = await get(item.legacyKey);
      if (existing !== null) {
        if (existing === raw) {
          alreadyMatched.push({ key: item.legacyKey, byteLength: item.byteLength });
          continue;
        }
        conflicts.push({ key: item.legacyKey, legacyBytes: item.byteLength,
          indexedDbBytes: new Blob([existing]).size });
        continue;
      }
      await set(item.legacyKey, raw);
      const copied = await get(item.legacyKey);
      if (copied !== raw) throw new Error("Migration verification failed for " + item.legacyKey);
      migrated.push({ key: item.legacyKey, byteLength: item.byteLength, validJson: item.validJson });
    }
    return { ok: conflicts.length === 0 && invalid.length === 0, nonDestructive: true,
      migratedCount: migrated.length, migrated, alreadyMatched, conflicts, invalid };
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
    const suffix = Date.now() + ":" + Math.random().toString(36).slice(2);
    const testKey = "__tha_idb_self_test__:" + suffix;
    const testValue = JSON.stringify({ marker: "THA-IDB-SELF-TEST", createdAt: new Date().toISOString(), payload: "read-write-verify-delete" });
    const recordId = "__tha_idb_self_test__:" + suffix;
    let writeVerified = false, readVerified = false, listed = false, deleteVerified = false;
    let typedPutVerified = false, typedReadVerified = false, typedListVerified = false, typedDeleteVerified = false;
    let kvSaved = false, recordSaved = false;
    try {
      await set(testKey, testValue);
      kvSaved = true;
      writeVerified = true;
      readVerified = (await get(testKey)) === testValue;
      listed = (await keys()).includes(testKey);
      if (!readVerified || !listed) throw new Error("IndexedDB key/value read/list verification failed");

      const fixture = { id: recordId, marker: "THA-IDB-RECORD-SELF-TEST", nested: { amount: 300 }, createdAt: new Date().toISOString() };
      await putRecord("projectMetadata", fixture);
      recordSaved = true;
      typedPutVerified = true;
      const loaded = await getRecord("projectMetadata", recordId);
      typedReadVerified = !!loaded && JSON.stringify(loaded) === JSON.stringify(fixture);
      const all = await getAllRecords("projectMetadata");
      typedListVerified = all.some(item => item.id === recordId) && (await countRecords("projectMetadata")) >= 1;
      if (!typedReadVerified || !typedListVerified) throw new Error("Typed IndexedDB record read/list verification failed");

      await deleteRecord("projectMetadata", recordId);
      recordSaved = false;
      typedDeleteVerified = (await getRecord("projectMetadata", recordId)) === null;

      await remove(testKey);
      kvSaved = false;
      deleteVerified = (await get(testKey)) === null && !(await keys()).includes(testKey);
      if (!typedDeleteVerified || !deleteVerified) throw new Error("IndexedDB delete verification failed");

      const checks = { writeVerified, readVerified, listed, deleteVerified, typedPutVerified, typedReadVerified, typedListVerified, typedDeleteVerified };
      return { ok: Object.values(checks).every(Boolean), database: DB_NAME, schemaVersion: DB_VERSION,
        checks, legacyDataChanged: false, operationalDataChanged: false };
    } catch (error) {
      if (recordSaved) { try { await deleteRecord("projectMetadata", recordId); } catch (_) {} }
      if (kvSaved) { try { await remove(testKey); } catch (_) {} }
      const checks = { writeVerified, readVerified, listed, deleteVerified, typedPutVerified, typedReadVerified, typedListVerified, typedDeleteVerified };
      return { ok: false, database: DB_NAME, schemaVersion: DB_VERSION,
        checks, legacyDataChanged: false, operationalDataChanged: false,
        error: String(error && error.message || error) };
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
    openDatabase, get, set, remove, keys,
    putRecord, getRecord, getAllRecords, countRecords, deleteRecord, bulkPutRecords,
    snapshotLegacyData, migrateLegacyData, verifyMigration, selfTest, status,
    legacyKeys: LEGACY_KEYS.slice(),
    stores: [...STORES, KV_STORE], databaseName: DB_NAME, schemaVersion: DB_VERSION
  });
})();
