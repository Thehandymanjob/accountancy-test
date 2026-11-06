/* The Handyman Accountancy v250 - isolated Accounting -> IndexedDB migration.
   Read-only inspection plus explicit, non-destructive copy. No app cutover.
   LocalStorage is never removed or written by this module.
*/
(function (root) {
  "use strict";
  const ACCOUNTING_KEY = "tha_test226_accounting_v1";
  const SEQUENCE_KEY = "tha_test226_invoice_sequence_v1";
  const SEQUENCE_CLEANUP_KEY = "tha_test226_invoice_sequence_cleanup_v1";
  const STORE_MAP = Object.freeze({
    entries: "accountingEntries",
    customers: "customers",
    invoices: "invoices",
    settings: "accountingSettings",
    customExpenseCategories: "customExpenseCategories"
  });
  const OPTIONAL_ARRAYS = ["customExpenseCategories"];

  function api() {
    const value = root.HandymanStorageFoundation;
    if (!value) throw new Error("IndexedDB foundation is not loaded.");
    return value;
  }
  function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object") {
      return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
    }
    return JSON.stringify(value);
  }
  function parseJson(raw, key) {
    try { return JSON.parse(raw); }
    catch (_) { throw new Error("Saved value is not valid JSON: " + key); }
  }
  function readSource() {
    const rawAccounting = root.localStorage.getItem(ACCOUNTING_KEY);
    const rawSequence = root.localStorage.getItem(SEQUENCE_KEY);
    const rawSequenceCleanup = root.localStorage.getItem(SEQUENCE_CLEANUP_KEY);
    if (rawAccounting === null) throw new Error("Accounting LocalStorage key was not found. Open the v250 test app in this browser first.");
    const data = parseJson(rawAccounting, ACCOUNTING_KEY);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Accounting data must be an object.");
    for (const key of ["entries", "customers", "invoices"]) {
      if (!Array.isArray(data[key])) throw new Error("Accounting data is missing a valid " + key + " array.");
    }
    for (const key of OPTIONAL_ARRAYS) {
      if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error("Accounting " + key + " must be an array.");
    }
    if (!data.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) {
      throw new Error("Accounting settings are missing or invalid.");
    }
    return {
      raw: { [ACCOUNTING_KEY]: rawAccounting, [SEQUENCE_KEY]: rawSequence, [SEQUENCE_CLEANUP_KEY]: rawSequenceCleanup },
      data,
      sequence: rawSequence === null ? null : parseJson(rawSequence, SEQUENCE_KEY),
      sequenceCleanup: rawSequenceCleanup === null ? null : parseJson(rawSequenceCleanup, SEQUENCE_CLEANUP_KEY)
    };
  }
  function rowsFor(name, list) {
    const seen = new Set(), duplicates = [], records = [];
    list.forEach((source, index) => {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        duplicates.push({ index, reason: "Record is not an object." });
        return;
      }
      const originalId = source.id;
      const id = originalId === undefined || originalId === null || String(originalId).trim() === ""
        ? "legacy-" + name + "-" + String(index + 1).padStart(6, "0")
        : String(originalId);
      if (seen.has(id)) {
        duplicates.push({ index, id, reason: "Duplicate source ID." });
        return;
      }
      seen.add(id);
      records.push({ ...source, id });
    });
    return { records, duplicates };
  }
  function buildPlan(source) {
    const data = source.data;
    const byStore = {
      accountingEntries: rowsFor("entry", data.entries),
      customers: rowsFor("customer", data.customers),
      invoices: rowsFor("invoice", data.invoices),
      customExpenseCategories: rowsFor("category", (data.customExpenseCategories || []).map((name, index) => ({
        id: "legacy-category-" + String(index + 1).padStart(6, "0"), name: String(name), position: index
      }))),
      accountingSettings: { records: [{ id: "accounting-settings", value: data.settings }], duplicates: [] },
      recordOrder: { records: [], duplicates: [] }
    };
    if (source.raw[SEQUENCE_KEY] !== null) byStore.recordOrder.records.push({
      id: "invoice-sequence", legacyKey: SEQUENCE_KEY, rawValue: source.raw[SEQUENCE_KEY], value: source.sequence
    });
    if (source.raw[SEQUENCE_CLEANUP_KEY] !== null) byStore.recordOrder.records.push({
      id: "invoice-sequence-cleanup", legacyKey: SEQUENCE_CLEANUP_KEY,
      rawValue: source.raw[SEQUENCE_CLEANUP_KEY], value: source.sequenceCleanup
    });
    return byStore;
  }
  async function inspectCurrent() {
    const source = readSource(), plan = buildPlan(source), a = api();
    const stores = {}, conflicts = [], invalid = [];
    for (const [store, group] of Object.entries(plan)) {
      if (group.duplicates.length) invalid.push({ store, records: group.duplicates });
      const existing = await a.getAllRecords(store);
      const existingById = new Map(existing.map(record => [String(record.id), record]));
      let identical = 0, toAdd = 0;
      for (const incoming of group.records) {
        const prior = existingById.get(String(incoming.id));
        if (!prior) { toAdd++; continue; }
        if (canonical(prior) === canonical(incoming)) identical++;
        else conflicts.push({ store, id: String(incoming.id), reason: "IndexedDB already contains a different record with this ID." });
      }
      stores[store] = { sourceCount: group.records.length, existingCount: existing.length, identical, toAdd };
    }
    return {
      ok: invalid.length === 0 && conflicts.length === 0,
      readOnly: true, willWrite: false, appCutover: false,
      localStorageChanged: false, backupChanged: false,
      sourceKeys: Object.entries(source.raw).map(([key, raw]) => ({
        key, present: raw !== null, bytes: raw === null ? 0 : new Blob([raw]).size
      })),
      stores, conflicts, invalid,
      totalSourceRecords: Object.values(stores).reduce((n, x) => n + x.sourceCount, 0),
      totalToAdd: Object.values(stores).reduce((n, x) => n + x.toAdd, 0)
    };
  }
  async function snapshotLegacyDataAppendOnly() {
    const db = await api().openDatabase();
    const prefix = "tha_test226_";
    const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const sourceRows = [];
    for (let i = 0; i < root.localStorage.length; i++) {
      const key = root.localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const raw = root.localStorage.getItem(key);
      let validJson = true;
      try { JSON.parse(raw); } catch (_) { validJson = false; }
      sourceRows.push({
        id: "snapshot:" + key + ":" + stamp,
        legacyKey: key, present: true, raw,
        byteLength: new Blob([raw]).size, validJson,
        capturedAt: new Date().toISOString(), snapshotKind: "append-only"
      });
    }
    sourceRows.sort((a, b) => a.legacyKey.localeCompare(b.legacyKey));
    try {
      const tx = db.transaction(["legacySnapshots"], "readwrite");
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("Legacy snapshot transaction failed."));
        tx.onabort = () => reject(tx.error || new Error("Legacy snapshot transaction aborted."));
      });
      const store = tx.objectStore("legacySnapshots");
      for (const row of sourceRows) store.add(row);
      await done;
      const verifyTx = db.transaction(["legacySnapshots"], "readonly");
      const verifyDone = new Promise((resolve, reject) => {
        verifyTx.oncomplete = resolve;
        verifyTx.onerror = () => reject(verifyTx.error || new Error("Legacy snapshot verification failed."));
        verifyTx.onabort = () => reject(verifyTx.error || new Error("Legacy snapshot verification aborted."));
      });
      const checks = sourceRows.map(row => new Promise((resolve, reject) => {
        const request = verifyTx.objectStore("legacySnapshots").get(row.id);
        request.onsuccess = () => resolve(!!request.result && request.result.raw === row.raw);
        request.onerror = () => reject(request.error || new Error("Snapshot read-back failed."));
      }));
      const verified = await Promise.all(checks);
      await verifyDone;
      if (verified.some(value => !value)) throw new Error("Append-only legacy snapshot read-back did not match.");
      return { ok: true, mode: "append-only", count: sourceRows.length,
        keys: sourceRows.map(row => ({ key: row.legacyKey, bytes: row.byteLength, validJson: row.validJson })) };
    } finally { db.close(); }
  }
  async function migrateCurrent() {
    const before = readSource();
    const preview = await inspectCurrent();
    if (!preview.ok) throw new Error("Accounting migration stopped: resolve source validation errors or IndexedDB conflicts before importing.");
    // Append a new immutable snapshot; never overwrite an earlier recovery snapshot.
    const snapshot = await snapshotLegacyDataAppendOnly();
    if (!snapshot || !snapshot.ok) throw new Error("Legacy snapshot could not be completed; no Accounting records were imported.");
    const current = readSource();
    for (const key of Object.keys(before.raw)) {
      if (before.raw[key] !== current.raw[key]) throw new Error("LocalStorage changed during migration preparation: " + key);
    }
    const plan = buildPlan(current), operations = {};
    for (const [store, group] of Object.entries(plan)) {
      const existing = await api().getAllRecords(store);
      const existingById = new Map(existing.map(record => [String(record.id), record]));
      const add = [];
      for (const incoming of group.records) {
        const prior = existingById.get(String(incoming.id));
        if (!prior) add.push(incoming);
        else if (canonical(prior) !== canonical(incoming)) throw new Error("Conflict detected before write: " + store + "/" + incoming.id);
      }
      operations[store] = add;
    }
    const writeSet = Object.fromEntries(Object.entries(operations).filter(([, rows]) => rows.length));
    let writeResult = { ok: true, atomic: true, added: 0, stores: [], verification: {} };
    if (Object.keys(writeSet).length) writeResult = await api().bulkAddAcrossStores(writeSet);
    const verified = {};
    for (const [store, group] of Object.entries(plan)) {
      verified[store] = [];
      for (const incoming of group.records) {
        const saved = await api().getRecord(store, incoming.id);
        if (!saved || canonical(saved) !== canonical(incoming)) throw new Error("Post-write verification failed: " + store + "/" + incoming.id);
        verified[store].push(String(incoming.id));
      }
    }
    const after = readSource();
    for (const key of Object.keys(before.raw)) {
      if (before.raw[key] !== after.raw[key]) throw new Error("Safety check failed: LocalStorage changed during import: " + key);
    }
    return {
      ok: true, atomic: writeResult.atomic !== false, snapshot,
      added: writeResult.written || 0, stores: Object.keys(plan),
      verifiedCounts: Object.fromEntries(Object.entries(plan).map(([store, group]) => [store, group.records.length])),
      verification: verified, localStorageChanged: false, backupChanged: false,
      appCutover: false, note: "Copied only. The live app continues to read and write LocalStorage."
    };
  }
  root.HandymanAccountingIDBMigration = Object.freeze({
    inspectCurrent, migrateCurrent, stores: Object.values(STORE_MAP)
  });
})(window);
