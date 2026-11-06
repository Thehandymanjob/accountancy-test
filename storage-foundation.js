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
      tx.onerror = () => { const e = tx.error; reject(new Error("IndexedDB transaction failed" + (e && e.name ? " (" + e.name + ")" : "") + (e && e.message ? ": " + e.message : ""))); };
      tx.onabort = () => { const e = tx.error; reject(new Error("IndexedDB transaction aborted" + (e && e.name ? " (" + e.name + ")" : "") + (e && e.message ? ": " + e.message : ""))); };
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

  async function bulkAddAcrossStores(recordsByStore) {
    if (!recordsByStore || typeof recordsByStore !== "object" || Array.isArray(recordsByStore)) {
      throw new Error("Cross-store write requires a store-to-records object.");
    }
    const storeNames = Object.keys(recordsByStore);
    if (!storeNames.length) throw new Error("Cross-store write contains no stores.");
    for (const name of storeNames) {
      assertRecordStore(name);
      if (!Array.isArray(recordsByStore[name])) throw new Error("Records for " + name + " must be an array.");
      const ids = new Set();
      for (const record of recordsByStore[name]) {
        validateRecord(record);
        const id = String(record.id);
        if (ids.has(id)) throw new Error("Duplicate record id in " + name + ": " + id);
        ids.add(id);
      }
    }
    const db = await openDatabase();
    try {
      const tx = db.transaction(storeNames, "readwrite");
      const done = transactionDone(tx);
      for (const name of storeNames) {
        const store = tx.objectStore(name);
        for (const record of recordsByStore[name]) store.add(record);
      }
      await done;
      const verification = {};
      for (const name of storeNames) {
        verification[name] = [];
        for (const record of recordsByStore[name]) {
          const saved = await getRecord(name, record.id);
          if (!saved || JSON.stringify(saved) !== JSON.stringify(record)) {
            throw new Error("Cross-store write verification failed for " + name + "/" + record.id);
          }
          verification[name].push(record.id);
        }
      }
      return { ok: true, atomic: true, stores: storeNames, written: Object.values(recordsByStore).reduce((n, rows) => n + rows.length, 0), verification };
    } finally { db.close(); }
  }

  async function bulkAddAcrossStoresVerified(recordsByStore) {
    if (!recordsByStore || typeof recordsByStore !== "object" || Array.isArray(recordsByStore)) {
      throw new Error("Verified cross-store write requires a store-to-records object.");
    }
    const storeNames = Object.keys(recordsByStore);
    if (!storeNames.length) throw new Error("Verified cross-store write contains no stores.");
    for (const name of storeNames) {
      assertRecordStore(name);
      if (!Array.isArray(recordsByStore[name])) throw new Error("Records for " + name + " must be an array.");
      const ids = new Set();
      for (const record of recordsByStore[name]) {
        validateRecord(record);
        const id = String(record.id);
        if (ids.has(id)) throw new Error("Duplicate record id in " + name + ": " + id);
        ids.add(id);
      }
    }
    const db = await openDatabase();
    try {
      const tx = db.transaction(storeNames, "readwrite");
      const done = transactionDone(tx);
      const verification = {};
      for (const name of storeNames) {
        verification[name] = [];
        const store = tx.objectStore(name);
        for (const record of recordsByStore[name]) {
          const addRequest = store.add(record);
          addRequest.onsuccess = () => {
            const readRequest = store.get(record.id);
            readRequest.onsuccess = () => {
              if (!readRequest.result || JSON.stringify(readRequest.result) !== JSON.stringify(record)) {
                try { tx.abort(); } catch (_) {}
                return;
              }
              verification[name].push(record.id);
            };
            readRequest.onerror = () => { try { tx.abort(); } catch (_) {} };
          };
          addRequest.onerror = () => { try { tx.abort(); } catch (_) {} };
        }
      }
      await done;
      const written = Object.values(recordsByStore).reduce((n, rows) => n + rows.length, 0);
      const verified = Object.values(verification).reduce((n, ids) => n + ids.length, 0);
      if (verified !== written) throw new Error("Atomic in-transaction verification count mismatch.");
      return { ok: true, atomic: true, verifiedInsideTransaction: true, stores: storeNames, written, verification };
    } finally { db.close(); }
  }

  async function bulkWriteAcrossStores(operationsByStore) {
    if (!operationsByStore || typeof operationsByStore !== "object" || Array.isArray(operationsByStore)) throw new Error("Cross-store merge requires an operations object.");
    const names = Object.keys(operationsByStore);
    if (!names.length) throw new Error("Cross-store merge contains no operations.");
    for (const name of names) {
      assertRecordStore(name); const group = operationsByStore[name];
      if (!group || !Array.isArray(group.add) || !Array.isArray(group.put)) throw new Error("Each store requires add and put arrays: " + name);
      const ids = new Set();
      for (const record of [...group.add, ...group.put]) { validateRecord(record); const id = String(record.id); if (ids.has(id)) throw new Error("Duplicate operation id in " + name + ": " + id); ids.add(id); }
    }
    const db = await openDatabase();
    try {
      const tx = db.transaction(names, "readwrite"); const done = transactionDone(tx);
      for (const name of names) { const store = tx.objectStore(name); const group = operationsByStore[name]; for (const record of group.add) store.add(record); for (const record of group.put) store.put(record); }
      await done; const verification = {};
      for (const name of names) { verification[name] = []; for (const record of [...operationsByStore[name].add, ...operationsByStore[name].put]) { const saved = await getRecord(name, record.id); if (!saved || JSON.stringify(saved) !== JSON.stringify(record)) throw new Error("Cross-store merge verification failed for " + name + "/" + record.id); verification[name].push(record.id); } }
      return { ok: true, atomic: true, stores: names, added: names.reduce((n,k)=>n+operationsByStore[k].add.length,0), updated: names.reduce((n,k)=>n+operationsByStore[k].put.length,0), verification };
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
    putRecord, getRecord, getAllRecords, countRecords, deleteRecord, bulkPutRecords, bulkAddAcrossStores, bulkAddAcrossStoresVerified, bulkWriteAcrossStores,
    snapshotLegacyData, migrateLegacyData, verifyMigration, selfTest, status,
    legacyKeys: LEGACY_KEYS.slice(),
    stores: [...STORES, KV_STORE], databaseName: DB_NAME, schemaVersion: DB_VERSION
  });
})();
