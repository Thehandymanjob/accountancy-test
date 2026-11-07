# v250 IndexedDB Integration Plan — Read-only Call-site Review

- Repository: `Thehandymanjob/accountancy-test`
- Branch: `release239` (existing branch only)
- Application baseline: v250
- Reviewed source: `index.html` blob `f6bdb6a31fd9e424ca0464b5fb725c4ad0fb2315`
- Repository adapter: `storage-repository.js` blob `4d4479376ecf2581cbdf4326aa37bf1d289ed448`
- Scope: source review and integration contract only
- Status: **no application code changed; no app cutover; no backup imported**

## 1. Important clarification about transaction scope

The current repository schema uses one object store, `records`, plus `metadata`. Business domains are namespaced records inside `records`; they are not separate IndexedDB object stores.

Therefore the first-cutover target does **not** need a multi-object-store transaction to atomically update Accounting, Projects and Contracts. It needs one IndexedDB read-write transaction on `records` that atomically updates all relevant domain envelopes.

The current `transact(writes)` can atomically write a non-empty list of records in that one store. However, it currently has no transaction-scoped read/modify/write API, conditional update, or deliberate abort test. The existing self-test's `atomicBatch` proves a successful batch write, not rollback after an injected failure and not concurrent invoice-number allocation.

## 2. Current source facts

### Application startup

- `loadDB()` reads the Accounting envelope synchronously from LocalStorage.
- `prLoad()` reads the Projects workspace synchronously from LocalStorage.
- Startup then runs invoice-sequence cleanup/reset, assigns numbers to existing income records, removes orphaned invoice-linked income records, ensures invoice fields, and performs additional persistence.
- These startup steps currently depend on synchronous in-memory state and storage return values.

**Integration consequence:** the app needs an asynchronous bootstrap barrier. The UI must not enable editing, invoice creation, project operations, reports, or backup until the canonical IndexedDB envelopes have been loaded and validated. Startup repairs must be explicitly classified and persisted only after validation; they must not run against empty defaults when IndexedDB is unavailable.

### Main synchronous persistence APIs

| Existing function | Occurrences in `index.html` | Current role | Required conversion |
|---|---:|---|---|
| `persist()` | 18 | Accounting write + read-back + success/error UI | Convert function and all dependent callers to `async`; await repository commit and read-back before reporting success. |
| `prPersist()` | 30 | Whole Projects workspace write + read-back + recovery lock | Convert all callers and event handlers to await; preserve previous workspace on failure. |
| `ctWrite()` | 3 | Contract list write + validation + rollback | Convert callers to await; store the full canonical Contracts envelope. |
| `ctRead()` | 6 | Contract read and validation | Replace with async repository read; retain corruption/recovery lock behavior. |

The occurrence counts are source-text matches in the reviewed v250 file, including definitions and calls; they are not a count of unique UI workflows.

### Cross-domain and critical workflows

| Workflow / functions | Data touched | Required repository behavior |
|---|---|---|
| Invoice creation and numbering: `reserveRecordNumber()`, `nextSharedRecordNumber()`, invoice submit handlers | Accounting envelope, invoice sequence metadata | Atomic read/modify/write inside one read-write transaction. Two tabs must never reserve the same number. A plain sequence `get()` followed by `put()` is unsafe. |
| Invoice payment/status and linked income: invoice status handlers, `updateInvoiceStatusDiagnostic()`, `removeOrphanedInvoiceIncome()` | Accounting envelope containing invoices and entries | Update both arrays in the same canonical Accounting envelope and commit once. Diagnostics must read the repository, not LocalStorage. |
| Full backup: `backup()` | Accounting, Projects, Contracts, app metadata | Take one consistent snapshot of all included canonical envelopes; do not combine stale in-memory state with separately read persistent records. |
| Full restore: `restore()`, `safeWrite()`, `mergeById()` | Accounting, Projects, Contracts | Validate and prepare all payloads first, then atomically replace/merge all declared envelopes in one repository transaction. Retain existing merge semantics only after tests prove them. |
| Project workspace: `prLoad()`, `prPersist()`, `prSaveProject()`, project editing and subproject flows | Complete Projects workspace | Keep the full nested workspace as canonical. Do not split project/subproject ledgers into separately authoritative records during first cutover. |
| Project completion: `prToggleProjectCompletion()` | Projects workspace | Use awaited repository write; show success only after commit. Preserve the current rule that completion toggle itself does not create/sync financial entries. |
| Project restore: `prRestore()` | Projects workspace | Validate before write; replace one canonical envelope atomically; preserve recovery lock and restore failure behavior. |
| Contracts: `ctRead()`, `ctWrite()` and their callers | Contracts envelope | Validate shape and IDs before write; await durable commit. |
| Contractor picker: `updateMainExpenseFields()` | Projects workspace contractors | Read from the canonical Projects envelope or already validated in-memory workspace; remove direct LocalStorage read. |
| Factory reset: `factoryResetFinalConfirm()` | Accounting, Projects, Contracts, invoice sequence, recovery snapshot | First commit an immutable recovery snapshot and reset marker atomically. Do not delete LocalStorage as part of the IndexedDB cutover. Reset requires a separate explicit user confirmation and dedicated tests. |
| Diagnostics: `monitorReadLog()`, `monitorWriteLog()`, `monitorContext()`, `logMonitorEvent()` | Monitor envelope | Best-effort, bounded retention. Monitor failure must never turn a successful business transaction into a failed save or hide the original error. |
| Language: `currentAppLang()`, `applyAppLanguage()`, `reportArchiveLanguage()` | Preferences | Load preferences during async bootstrap, then apply language before exposing the app. Preserve language validation and current preference-version behavior without startup LocalStorage writes. |
| Reports: report archive/settings/workflow/email/notifications helpers | Separate report envelopes | Inventory each key and caller; persist each named report domain through repository methods. |
| Support drafts | Support draft envelope | Preserve local-only/not-sent status; do not silently discard on storage migration. |

## 3. Canonical domain envelope map

Keep the first migration source-preserving and minimal:

| Domain | Record key | Canonical payload |
|---|---|---|
| `accounting` | `main` | Entire Accounting object: entries, customers, invoices, settings, custom categories, third-party transactions and unknown fields. |
| `projects` | `workspace` | Entire Projects workspace: projects, nested subprojects/ledgers, directories, profile/images and workspace selectors. |
| `contracts` | `main` | Complete contract array/payload. |
| `preferences` | `main` | Explicitly defined language and invoice-sequence metadata; preserve unknown preference fields only when sourced from an approved backup or deliberately migrated under a documented rule. |
| `reports` | named keys | Archive, notifications, settings, workflow and email settings as distinct records. |
| `diagnostics` | `monitor-log` | Bounded monitor events; not part of business-ledger atomicity. |
| `support` | `drafts` | Local support drafts. |
| `recovery` | unique snapshot key | Immutable recovery snapshot and metadata. |
| `migration` | named state keys | Migration status, source hash, schema/app-data version and audit metadata. |

Do not create row-per-invoice/project/receipt stores in the first cutover. The complete Accounting and Projects envelopes remain the sole authoritative representations.

## 4. Repository API gaps to close before app integration

The browser-passed prototype currently exposes `ready`, `get`, `put`, `remove`, `transact(writes)`, `snapshot`, `restore`, `health` and `selfTest`.

Before app integration, add and test:

1. **Transaction-scoped read/modify/write:** a safe API for reading and updating the invoice sequence and canonical envelopes within the same active read-write transaction. Do not implement this as separate `get()` and `put()` calls.
2. **Atomic multi-domain envelope commit:** a named helper or validated transaction wrapper that writes Accounting + Projects + Contracts envelopes together in the single `records` object store.
3. **Abort/rollback test:** deliberately abort after scheduling multiple writes and prove that none of the envelopes changed.
4. **Concurrent sequence reservation test:** run competing reservations and prove unique, monotonic numbers.
5. **Transaction lifecycle hardening:** avoid arbitrary asynchronous gaps inside an IndexedDB transaction. Queue requests while the transaction is active; resolve only on transaction completion; test on iPhone Safari.
6. **Snapshot consistency:** snapshot all required envelopes from one readonly transaction and restore them atomically.
7. **Failure semantics:** normalize quota, abort, blocked-upgrade and unavailable-storage errors; never return success before transaction completion and read-back.
8. **Bootstrap/readiness contract:** expose a single `openAndValidate()`/bootstrap operation that verifies schema and required envelopes before the UI is unlocked.
9. **No fallback contract:** after an explicitly approved cutover, IndexedDB failure must stop writes and show a clear recovery error; never write to LocalStorage as fallback.

### Serialization constraints

The adapter uses JSON serialization. This preserves JSON values such as null, false, zero, empty strings, nested objects/arrays and image data URLs. It does not preserve JavaScript-only values such as `undefined`, functions, Date instances, Map/Set, Blob objects or cyclic references as such. The approved v6 payload is JSON; any app runtime values must be converted to a documented JSON representation before persistence. Do not silently coerce fields during migration.

## 5. Additional audit findings and discrepancy to resolve

- A fresh scan of the reviewed `index.html` confirms 93 direct LocalStorage method-call expressions.
- The same scan also found additional `window.localStorage` references and possible alias declarations; the final no-LocalStorage audit must inspect these, bracket notation and indirect wrappers rather than relying only on direct method-call count.
- A fresh scan of `storage-foundation.js` found 8 LocalStorage method-call expressions, whereas the earlier manifest section 13 recorded 5. This count discrepancy must be reconciled by classifying each occurrence as migration-only, inventory-only, or normal-runtime access before any cutover claim.
- `version-manager.js` has zero direct LocalStorage method-call expressions in the reviewed file.
- `storage-repository.js` itself has no LocalStorage calls and is not loaded by the app's `index.html`.

## 6. Required implementation order

1. Finish the complete storage-access audit across `index.html`, both external scripts, inline/dynamic scripts and aliases.
2. Extend and test repository transaction primitives in the isolated lab only.
3. Write a domain adapter layer with no UI changes and no app import of backup data.
4. Convert startup to an asynchronous bootstrap in a separate test-only integration step.
5. Convert Accounting, Projects and Contracts persistence APIs and every caller; use static checks to ensure no synchronous boolean assumptions remain.
6. Convert invoice numbering, invoice/payment cross-record logic, backup/restore and factory reset with explicit transaction tests.
7. Convert report/preferences/monitor/support persistence.
8. Run automated/static regression checks, then user-side iPhone Safari workflow tests on the test app.
9. Only after complete parity, separately request approval for importing the approved v6 backup into a new isolated app database.
10. Only after successful reconciliation and separate explicit authorization, consider app cutover. Production remains a separate approval gate.

## 7. Safety boundary

This review did not change `index.html`, `storage-repository.js`, the lab, LocalStorage, any browser database, the approved backup, or production. It did not import data or perform cutover. Continue only on existing `release239`; do not create a branch.