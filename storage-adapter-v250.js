/* The Handyman Accountancy v250 — central IndexedDB Storage Adapter.
   Isolated adapter layer for release239. It does not access LocalStorage,
   does not alter the app entry point, and does not enable application cutover.
*/
(function (root) {
  "use strict";

  const EXPECTED_DATABASE = "the_handyman_accountancy_test226";
  const MIN_SCHEMA_VERSION = 4;
  const OPERATIONAL_STORES = Object.freeze([
    "customers", "projects", "invoices", "contracts", "accountingEntries",
    "projectReceipts", "projectExpenses", "workers", "partners", "contractors",
    "companies", "companyJobs", "customExpenseCategories",
    "thirdPartyTransactions", "accountingSettings", "projectMetadata",
    "auditLog", "recordOrder"
  ]);
  const DOMAIN_STORES = Object.freeze({
    customers: "customers",
    projects: "projects",
    invoices: "invoices",
    contracts: "contracts",
    accountingEntries: "accountingEntries",
    projectReceipts: "projectReceipts",
    projectExpenses: "projectExpenses",
    workers: "workers",
    partners: "partners",
    contractors: "contractors",
    companies: "companies",
    companyJobs: "companyJobs",
    customExpenseCategories: "customExpenseCategories",
    thirdPartyTransactions: "thirdPartyTransactions",
    accountingSettings: "accountingSettings",
    projectMetadata: "projectMetadata"
  });
  const COUNTER_PREFIX = "__tha_storage_adapter_counter_v1__:";

  function foundation() {
    const api = root.HandymanStorageFoundation;
    if (!api || typeof api.openDatabase !== "function") {
      throw new Error("Storage Foundation is not loaded.");
    }
    if (api.databaseName !== EXPECTED_DATABASE) {
      throw new Error("Unexpected IndexedDB database: " + String(api.databaseName));
    }
    if (Number(api.schemaVersion) < MIN_SCHEMA_VERSION) {
      throw new Error("IndexedDB schema version is older than the adapter requirement.");
    }
    return api;
  }

  function assertStore(name) {
    if (!OPERATIONAL_STORES.includes(name)) {
      throw new Error("Unsupported operational store: " + String(name));
    }
    return name;
  }

  function validateRecord(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("A record must be a plain object.");
    }
    if ((typeof record.id !== "string" && typeof record.id !== "number") ||
        String(record.id).trim() === "" ||
        (typeof record.id === "number" && !Number.isFinite(record.id))) {
      throw new Error("A record requires a non-empty string or finite numeric id.");
    }
    return record;
  }

  function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object") {
      return "{" + Object.keys(value).sort().map(key =>
        JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
    }
    return JSON.stringify(value);
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted."));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
  }

  function normalizeChanges(changes) {
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      throw new Error("A transaction requires a store-to-operations object.");
    }
    const names = Object.keys(changes);
    if (!names.length) throw new Error("A transaction cannot be empty.");
    const normalized = {};
    for (const name of names) {
      assertStore(name);
      const group = changes[name];
      if (!group || typeof group !== "object" || Array.isArray(group)) {
        throw new Error("Invalid operation group for " + name);
      }
      const add = group.add === undefined ? [] : group.add;
      const put = group.put === undefined ? [] : group.put;
      const remove = group.delete === undefined ? [] : group.delete;
      if (!Array.isArray(add) || !Array.isArray(put) || !Array.isArray(remove)) {
        throw new Error("add, put and delete must be arrays for " + name);
      }
      const ids = new Set();
      for (const record of [...add, ...put]) {
        validateRecord(record);
        const id = String(record.id);
        if (ids.has(id)) throw new Error("Duplicate record operation: " + name + "/" + id);
        ids.add(id);
      }
      for (const id of remove) {
        if ((typeof id !== "string" && typeof id !== "number") || String(id).trim() === "") {
          throw new Error("Delete operations require a valid record id.");
        }
        const normalizedId = String(id);
        if (ids.has(normalizedId)) throw new Error("A record cannot be written and deleted in one transaction.");
        ids.add(normalizedId);
      }
      if (!add.length && !put.length && !remove.length) {
        throw new Error("Empty operation group for " + name);
      }
      normalized[name] = { add, put, delete: remove };
    }
    return normalized;
  }

  async function ready() {
    const api = foundation();
    const status = await api.status();
    const missing = OPERATIONAL_STORES.filter(name => !api.stores.includes(name) || !(name in status.stores));
    if (missing.length) throw new Error("Required IndexedDB stores are missing: " + missing.join(", "));
    return {
      ok: true,
      database: status.database,
      schemaVersion: status.schemaVersion,
      stores: OPERATIONAL_STORES.slice(),
      appCutover: false
    };
  }

  async function get(storeName, id) {
    assertStore(storeName);
    return foundation().getRecord(storeName, id);
  }

  async function list(storeName) {
    assertStore(storeName);
    return foundation().getAllRecords(storeName);
  }

  async function count(storeName) {
    assertStore(storeName);
    return foundation().countRecords(storeName);
  }

  async function commit(changes) {
    const api = foundation();
    const normalized = normalizeChanges(changes);
    const names = Object.keys(normalized);
    const db = await api.openDatabase();
    let result;
    try {
      const tx = db.transaction(names, "readwrite");
      const done = transactionDone(tx);
      for (const name of names) {
        const store = tx.objectStore(name);
        const group = normalized[name];
        for (const record of group.add) store.add(record);
        for (const record of group.put) store.put(record);
        for (const id of group.delete) store.delete(id);
      }
      await done;

      const verifyTx = db.transaction(names, "readonly");
      const verifyDone = transactionDone(verifyTx);
      const checks = [];
      for (const name of names) {
        const store = verifyTx.objectStore(name);
        const group = normalized[name];
        for (const record of [...group.add, ...group.put]) {
          checks.push(requestResult(store.get(record.id)).then(saved => {
            if (!saved || canonical(saved) !== canonical(record)) {
              throw new Error("Post-commit verification failed: " + name + "/" + record.id);
            }
          }));
        }
        for (const id of group.delete) {
          checks.push(requestResult(store.get(id)).then(saved => {
            if (saved !== undefined) throw new Error("Delete verification failed: " + name + "/" + id);
          }));
        }
      }
      await Promise.all([verifyDone, ...checks]);
      result = {
        ok: true,
        atomic: true,
        verified: true,
        stores: names,
        added: names.reduce((n, name) => n + normalized[name].add.length, 0),
        updated: names.reduce((n, name) => n + normalized[name].put.length, 0),
        deleted: names.reduce((n, name) => n + normalized[name].delete.length, 0)
      };
    } finally {
      db.close();
    }
    return result;
  }

  async function add(storeName, record) {
    assertStore(storeName);
    validateRecord(record);
    return commit({ [storeName]: { add: [record] } });
  }

  async function put(storeName, record) {
    assertStore(storeName);
    validateRecord(record);
    return commit({ [storeName]: { put: [record] } });
  }

  async function remove(storeName, id) {
    assertStore(storeName);
    return commit({ [storeName]: { delete: [id] } });
  }

  async function reserveCounter(name, options) {
    if (typeof name !== "string" || !name.trim()) throw new Error("Counter name is required.");
    const opts = options || {};
    const firstValue = opts.firstValue === undefined ? 1 : Number(opts.firstValue);
    if (!Number.isSafeInteger(firstValue) || firstValue < 0) {
      throw new Error("Counter firstValue must be a non-negative safe integer.");
    }
    const id = COUNTER_PREFIX + name.trim();
    const db = await foundation().openDatabase();
    let reserved;
    try {
      const tx = db.transaction(["recordOrder"], "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore("recordOrder");
      const read = store.get(id);
      read.onsuccess = () => {
        const current = read.result ? Number(read.result.value) : firstValue - 1;
        if (!Number.isSafeInteger(current) || current < firstValue - 1) {
          try { tx.abort(); } catch (_) {}
          return;
        }
        reserved = current + 1;
        store.put({
          id,
          kind: "storage-adapter-counter",
          name: name.trim(),
          value: reserved,
          updatedAt: new Date().toISOString()
        });
      };
      read.onerror = () => { try { tx.abort(); } catch (_) {} };
      await done;
    } finally {
      db.close();
    }
    if (!Number.isSafeInteger(reserved)) throw new Error("Counter reservation did not complete.");
    return reserved;
  }

  async function getSetting(key) {
    if (typeof key !== "string" || !key.trim()) throw new Error("Setting key is required.");
    const raw = await foundation().get("__tha_storage_adapter_setting_v1__:" + key);
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch (_) { return raw; }
  }

  async function setSetting(key, value) {
    if (typeof key !== "string" || !key.trim()) throw new Error("Setting key is required.");
    const raw = JSON.stringify(value);
    if (typeof raw !== "string") throw new Error("Setting value cannot be serialized.");
    await foundation().set("__tha_storage_adapter_setting_v1__:" + key, raw);
    const saved = await getSetting(key);
    if (canonical(saved) !== canonical(value)) throw new Error("Setting round-trip verification failed.");
    return { ok: true, key };
  }

  async function removeSetting(key) {
    if (typeof key !== "string" || !key.trim()) throw new Error("Setting key is required.");
    await foundation().remove("__tha_storage_adapter_setting_v1__:" + key);
    if (await getSetting(key) !== null) throw new Error("Setting deletion verification failed.");
    return true;
  }

  async function selfTest() {
    const token = "adapter-v250-test-" + Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2, 9);
    const projectId = token + ":project";
    const auditId = token + ":audit";
    const rollbackAuditId = token + ":rollback-audit";
    const counterName = token + ":counter";
    const counterId = COUNTER_PREFIX + counterName;
    const checks = {
      ready: false,
      multiStoreAtomicWrite: false,
      readAfterWrite: false,
      update: false,
      transactionRollback: false,
      concurrentCounterReservation: false,
      cleanup: false
    };
    let projectWritten = false;
    let auditWritten = false;
    let counterMayExist = false;
    let result = null;
    try {
      await ready();
      checks.ready = true;
      await commit({
        projectMetadata: { add: [{ id: projectId, kind: "adapter-self-test", payload: { keep: true } }] },
        auditLog: { add: [{ id: auditId, kind: "adapter-self-test", createdAt: new Date().toISOString() }] }
      });
      projectWritten = true;
      auditWritten = true;
      checks.multiStoreAtomicWrite = true;

      const project = await get("projectMetadata", projectId);
      const audit = await get("auditLog", auditId);
      checks.readAfterWrite = !!project && project.payload.keep === true &&
        !!audit && audit.kind === "adapter-self-test";

      await put("auditLog", { ...audit, updated: true });
      const updated = await get("auditLog", auditId);
      checks.update = !!updated && updated.updated === true;

      let rollbackRejected = false;
      try {
        await commit({
          auditLog: { add: [{ id: rollbackAuditId, kind: "must-rollback" }] },
          projectMetadata: { add: [{ id: projectId, kind: "duplicate-id" }] }
        });
      } catch (_) {
        rollbackRejected = true;
      }
      const rollbackRecord = await get("auditLog", rollbackAuditId);
      checks.transactionRollback = rollbackRejected && rollbackRecord === null;

      counterMayExist = true;
      const values = await Promise.all([
        reserveCounter(counterName), reserveCounter(counterName),
        reserveCounter(counterName), reserveCounter(counterName)
      ]);
      const unique = new Set(values);
      checks.concurrentCounterReservation = unique.size === 4 &&
        Math.max(...values) - Math.min(...values) === 3;

      if (!Object.entries(checks).filter(([key]) => key !== "cleanup").every(([, value]) => value)) {
        throw new Error("One or more Storage Adapter self-tests failed.");
      }
      result = { ok: true, reservedCounterValues: values.slice().sort((a, b) => a - b) };
    } catch (error) {
      result = { ok: false, error: String(error && error.message || error) };
    } finally {
      const cleanup = {};
      if (projectWritten) cleanup.projectMetadata = { delete: [projectId] };
      if (auditWritten) cleanup.auditLog = { delete: [auditId, rollbackAuditId] };
      if (counterMayExist) cleanup.recordOrder = { delete: [counterId] };
      try {
        if (Object.keys(cleanup).length) await commit(cleanup);
        checks.cleanup = true;
      } catch (_) {
        checks.cleanup = false;
      }
    }
    const ok = !!result && result.ok === true && checks.cleanup === true &&
      Object.entries(checks).every(([, value]) => value === true);
    return {
      ok,
      database: EXPECTED_DATABASE,
      checks,
      reservedCounterValues: result && result.reservedCounterValues || [],
      ...(result && result.error ? { error: result.error } : {}),
      localStorageChanged: false,
      appCutover: false
    };
  }

  root.HandymanStorageAdapterV250 = Object.freeze({
    version: "v250-adapter-prototype-1",
    databaseName: EXPECTED_DATABASE,
    stores: OPERATIONAL_STORES,
    domains: DOMAIN_STORES,
    ready, get, list, count, add, put, remove, commit,
    reserveCounter, getSetting, setSetting, removeSetting, selfTest
  });
})(window);
