/* The Handyman Accountancy v263 — IndexedDB-only storage engine.
   This module deliberately has no LocalStorage, SessionStorage, cookies, or CacheStorage
   access. It is an isolated foundation and is not the application cutover by itself.
   All values are stored with IndexedDB structured cloning (including Blob/File).
*/
(function (root) {
  "use strict";

  const DB_NAME = "the_handyman_accountancy_v263_idb";
  const DB_VERSION = 1;
  const STORE = "records";
  const META = "metadata";
  const BUILD = "THA-263-IDB-ONLY-FOUNDATION-1";

  const validDomain = value => typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
  const validKey = value => typeof value === "string" && value.length > 0 && value.length <= 512;
  const recordId = (domain, key) => domain + ":" + encodeURIComponent(key);
  const clone = value => {
    if (typeof root.structuredClone === "function") return root.structuredClone(value);
    // IndexedDB performs structured cloning on write/read. This fallback is only
    // used for callback isolation and intentionally rejects binary values.
    if (value instanceof Blob || (typeof File !== "undefined" && value instanceof File)) {
      throw new Error("This browser requires structuredClone support for binary mutation values.");
    }
    return JSON.parse(JSON.stringify(value));
  };
  const requestResult = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
  const transactionDone = tx => new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted."));
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
  });

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error("IndexedDB is unavailable in this browser."));
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("domain", "domain", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error("Could not open IndexedDB database."));
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another open tab."));
    });
  }

  function validateDescriptor(domain, key) {
    if (!validDomain(domain) || !validKey(key)) throw new Error("Invalid IndexedDB domain or key.");
    return { id: recordId(domain, key), domain, key };
  }
  function validateValue(value) {
    if (value === undefined) throw new Error("Undefined cannot be stored; use null explicitly.");
    // Validate structured-clone compatibility before opening a write transaction.
    if (typeof root.structuredClone === "function") {
      try { root.structuredClone(value); } catch (error) {
        throw new Error("Value cannot be stored by IndexedDB structured cloning: " + (error.message || error));
      }
    } else if (typeof value === "function" || typeof value === "symbol") {
      throw new Error("Functions and Symbols cannot be stored in IndexedDB.");
    }
    return value;
  }
  function assertUnique(descriptors, label) {
    const ids = new Set();
    for (const item of descriptors) {
      if (ids.has(item.id)) throw new Error("Duplicate key in " + label + ": " + item.domain + "/" + item.key);
      ids.add(item.id);
    }
  }

  async function ready() {
    const db = await openDatabase();
    try {
      const tx = db.transaction([META], "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore(META);
      const current = await requestResult(store.get("schema"));
      if (current && current.version !== 1) throw new Error("Unexpected v263 schema metadata.");
      if (!current) store.put({ key: "schema", version: 1, database: DB_NAME, build: BUILD, createdAt: new Date().toISOString() });
      await done;
      return { ok: true, database: DB_NAME, schemaVersion: DB_VERSION, build: BUILD };
    } finally { db.close(); }
  }

  async function get(domain, key) {
    const item = validateDescriptor(domain, key);
    const db = await openDatabase();
    try {
      const tx = db.transaction([STORE], "readonly");
      const done = transactionDone(tx);
      const row = await requestResult(tx.objectStore(STORE).get(item.id));
      await done;
      return row ? row.value : null;
    } finally { db.close(); }
  }

  async function readMany(descriptors) {
    if (!Array.isArray(descriptors) || descriptors.length === 0) throw new Error("A non-empty descriptor list is required.");
    const prepared = descriptors.map(x => validateDescriptor(x.domain, x.key));
    assertUnique(prepared, "read");
    const db = await openDatabase();
    try {
      const tx = db.transaction([STORE], "readonly");
      const done = transactionDone(tx);
      const store = tx.objectStore(STORE);
      const rows = await Promise.all(prepared.map(x => requestResult(store.get(x.id))));
      await done;
      return { ok: true, records: rows.map((row, i) => ({
        domain: prepared[i].domain, key: prepared[i].key, value: row ? row.value : null
      })) };
    } finally { db.close(); }
  }

  async function put(domain, key, value) {
    const item = validateDescriptor(domain, key);
    validateValue(value);
    const stamp = new Date().toISOString();
    const db = await openDatabase();
    try {
      const tx = db.transaction([STORE], "readwrite");
      const done = transactionDone(tx);
      tx.objectStore(STORE).put({ ...item, value, updatedAt: stamp });
      await done;
      const saved = await get(domain, key);
      // IndexedDB structured cloning preserves binary objects; compare primitive JSON
      // values only here. Binary round-trip is covered by the self-test.
      if (!(value instanceof Blob) && JSON.stringify(saved) !== JSON.stringify(value)) {
        throw new Error("IndexedDB read-back verification failed for " + domain + "/" + key);
      }
      if (value instanceof Blob && (!(saved instanceof Blob) || saved.size !== value.size || saved.type !== value.type)) {
        throw new Error("IndexedDB Blob read-back verification failed for " + domain + "/" + key);
      }
      return { ok: true, domain, key, updatedAt: stamp };
    } finally { db.close(); }
  }

  async function remove(domain, key) {
    const item = validateDescriptor(domain, key);
    const db = await openDatabase();
    try {
      const tx = db.transaction([STORE], "readwrite");
      const done = transactionDone(tx);
      tx.objectStore(STORE).delete(item.id);
      await done;
      const check = await get(domain, key);
      if (check !== null) throw new Error("IndexedDB delete verification failed for " + domain + "/" + key);
      return { ok: true, removed: true, domain, key };
    } finally { db.close(); }
  }

  async function transact(writes) {
    if (!Array.isArray(writes) || writes.length === 0) throw new Error("A non-empty write list is required.");
    const prepared = writes.map(x => {
      const item = validateDescriptor(x.domain, x.key);
      validateValue(x.value);
      return { ...item, value: x.value };
    });
    assertUnique(prepared, "transaction");
    const stamp = new Date().toISOString();
    const db = await openDatabase();
    try {
      const tx = db.transaction([STORE], "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore(STORE);
      for (const item of prepared) store.put({ ...item, updatedAt: stamp });
      await done;
      const verify = await readMany(prepared);
      for (let i = 0; i < prepared.length; i++) {
        if (JSON.stringify(verify.records[i].value) !== JSON.stringify(prepared[i].value)) {
          if (!(prepared[i].value instanceof Blob && verify.records[i].value instanceof Blob &&
                prepared[i].value.size === verify.records[i].value.size &&
                prepared[i].value.type === verify.records[i].value.type)) {
            throw new Error("IndexedDB transaction verification failed for " + prepared[i].domain + "/" + prepared[i].key);
          }
        }
      }
      return { ok: true, written: prepared.length, updatedAt: stamp };
    } finally { db.close(); }
  }

  async function mutateMany(descriptors, updater) {
    if (!Array.isArray(descriptors) || descriptors.length === 0 || typeof updater !== "function") {
      throw new Error("A non-empty descriptor list and synchronous updater are required.");
    }
    const prepared = descriptors.map(x => ({
      ...validateDescriptor(x.domain, x.key),
      initialValue: x.initialValue === undefined ? null : x.initialValue
    }));
    assertUnique(prepared, "mutation");
    const db = await openDatabase();
    const stamp = new Date().toISOString();
    try {
      const tx = db.transaction([STORE], "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore(STORE);
      const currentRows = await Promise.all(prepared.map(x => requestResult(store.get(x.id))));
      const current = currentRows.map((row, i) => ({
        domain: prepared[i].domain,
        key: prepared[i].key,
        value: row ? row.value : clone(prepared[i].initialValue)
      }));
      const next = updater(clone(current));
      if (next && typeof next.then === "function") throw new Error("IndexedDB mutation callback must be synchronous.");
      if (!Array.isArray(next) || next.length !== prepared.length) throw new Error("Mutation must return one value per descriptor.");
      for (let i = 0; i < prepared.length; i++) {
        validateValue(next[i]);
        store.put({ id: prepared[i].id, domain: prepared[i].domain, key: prepared[i].key, value: next[i], updatedAt: stamp });
      }
      await done;
      const verified = await readMany(prepared);
      for (let i = 0; i < prepared.length; i++) {
        if (JSON.stringify(verified.records[i].value) !== JSON.stringify(next[i])) {
          throw new Error("IndexedDB mutation read-back failed for " + prepared[i].domain + "/" + prepared[i].key);
        }
      }
      return { ok: true, updated: prepared.length, records: verified.records, updatedAt: stamp };
    } finally { db.close(); }
  }

  async function reserveCounter(domain, key, minimum) {
    let reserved;
    const result = await mutateMany([{ domain, key, initialValue: 0 }], rows => {
      reserved = Math.max(Number(rows[0].value) || 0, Number(minimum) || 0) + 1;
      return [reserved];
    });
    return { ok: result.ok, value: reserved };
  }

  async function snapshot(domains) {
    if (!Array.isArray(domains) || domains.some(x => !validDomain(x))) throw new Error("Invalid snapshot domains.");
    const db = await openDatabase();
    try {
      const tx = db.transaction([STORE], "readonly");
      const done = transactionDone(tx);
      const rows = await requestResult(tx.objectStore(STORE).getAll());
      await done;
      return {
        format: "tha-v263-indexeddb-snapshot-v1",
        database: DB_NAME,
        createdAt: new Date().toISOString(),
        domains: [...new Set(domains)].sort(),
        records: rows.filter(x => domains.includes(x.domain)).sort((a, b) => a.id.localeCompare(b.id))
      };
    } finally { db.close(); }
  }

  async function restore(packageValue) {
    if (!packageValue || packageValue.format !== "tha-v263-indexeddb-snapshot-v1" ||
        packageValue.database !== DB_NAME || !Array.isArray(packageValue.domains) ||
        !Array.isArray(packageValue.records)) throw new Error("Invalid v263 IndexedDB backup package.");
    const domains = [...new Set(packageValue.domains)];
    if (domains.length !== packageValue.domains.length || domains.some(x => !validDomain(x))) throw new Error("Invalid or duplicate backup domains.");
    const prepared = packageValue.records.map(row => {
      const item = validateDescriptor(row.domain, row.key);
      if (!domains.includes(row.domain)) throw new Error("Backup record is outside the declared domains.");
      validateValue(row.value);
      return { ...item, value: row.value };
    });
    assertUnique(prepared, "restore");
    const db = await openDatabase();
    try {
      const tx = db.transaction([STORE], "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore(STORE);
      const existing = await requestResult(store.getAll());
      for (const row of existing) if (domains.includes(row.domain)) store.delete(row.id);
      for (const row of prepared) store.put({ ...row, updatedAt: new Date().toISOString() });
      await done;
      const verify = await snapshot(domains);
      const expected = prepared.slice().sort((a, b) => a.id.localeCompare(b.id));
      if (verify.records.length !== expected.length ||
          verify.records.some((row, i) => row.id !== expected[i].id)) {
        throw new Error("IndexedDB restore verification failed.");
      }
      return { ok: true, restored: prepared.length, domains };
    } finally { db.close(); }
  }

  async function health() {
    const db = await openDatabase();
    try {
      const tx = db.transaction([STORE, META], "readonly");
      const done = transactionDone(tx);
      const [rows, meta] = await Promise.all([
        requestResult(tx.objectStore(STORE).getAll()),
        requestResult(tx.objectStore(META).get("schema"))
      ]);
      await done;
      const counts = {};
      for (const row of rows) counts[row.domain] = (counts[row.domain] || 0) + 1;
      return { ok: true, database: DB_NAME, schemaVersion: DB_VERSION, build: meta ? meta.build : null, totalRecords: rows.length, counts };
    } finally { db.close(); }
  }

  async function selfTest() {
    const token = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    const domain = "selftest_" + token;
    const checks = { ready: false, jsonRoundTrip: false, blobRoundTrip: false, atomicWrite: false, concurrentCounterReservation: false, delete: false };
    const keys = ["json", "blob", "atomic-a", "atomic-b", "counter"];

    try {
      await ready(); checks.ready = true;
      const sample = { n: 7, text: "test", empty: "", nested: [1, null, false] };
      await put(domain, keys[0], sample);
      const read = await get(domain, keys[0]);
      checks.jsonRoundTrip = JSON.stringify(read) === JSON.stringify(sample);
      if (!checks.jsonRoundTrip) throw new Error("JSON round-trip failed.");
      const blob = new Blob(["THA-v263-IDB-BLOB-TEST"], { type: "text/plain" });
      await put(domain, keys[1], blob);
      const blobRead = await get(domain, keys[1]);
      checks.blobRoundTrip = blobRead instanceof Blob && blobRead.size === blob.size && blobRead.type === blob.type &&
        (await blobRead.text()) === "THA-v263-IDB-BLOB-TEST";
      if (!checks.blobRoundTrip) throw new Error("Blob round-trip failed.");
      await transact([
        { domain, key: keys[2], value: { value: "A" } },
        { domain, key: keys[3], value: { value: "B" } }
      ]);
      const pair = await readMany([{ domain, key: keys[2] }, { domain, key: keys[3] }]);
      checks.atomicWrite = pair.records[0].value.value === "A" && pair.records[1].value.value === "B";
      if (!checks.atomicWrite) throw new Error("Atomic write test failed.");
      const reservations = await Promise.all(Array.from({ length: 6 }, () => reserveCounter(domain, keys[4], 0)));
      const numbers = reservations.map(x => x.value).sort((a, b) => a - b);
      checks.concurrentCounterReservation = numbers.length === 6 &&
        numbers.every((value, index) => value === index + 1) &&
        (await get(domain, keys[4])) === 6;
      if (!checks.concurrentCounterReservation) throw new Error("Concurrent counter reservation produced duplicate or missing numbers.");
      await remove(domain, keys[2]);
      checks.delete = (await get(domain, keys[2])) === null;
      if (!checks.delete) throw new Error("Delete test failed.");
      return { ok: Object.values(checks).every(Boolean), database: DB_NAME, build: BUILD, checks, noLocalStorageAccess: true, appCutover: false };
    } catch (error) {
      return { ok: false, database: DB_NAME, build: BUILD, checks, error: String(error.message || error), appCutover: false };
    } finally {
      for (const key of keys) { try { await remove(domain, key); } catch (_) {} }
    }
  }

  root.HandymanStorageV263 = Object.freeze({
    databaseName: DB_NAME, schemaVersion: DB_VERSION, build: BUILD,
    ready, get, readMany, put, remove, transact, mutateMany, reserveCounter,
    snapshot, restore, health, selfTest
  });
})(window);
