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

## 8. Isolated transaction primitive implementation — browser validation passed

Implemented on the existing `release239` branch:

- Repository module latest commit: `15875e80ab799d03f7dd517c293d1f0ebd28aa18`; blob SHA `f5d4c5d8e16361c3f7479840cd28c8aa57a453b4`.
- Lab latest commit: `07f53817e501a1dda08ed161ca161890a03306f7`; blob SHA `5831e0596e3f83c50ef74f86ec877a2a56d9dea1`.
- Repository build: `repo-selftest-20261107-02`.
- Lab build: `lab-selftest-20261107-02`.
- Added `mutate(operations)`: transaction-scoped read/modify/write callbacks for multiple namespaced records in one read-write transaction on the `records` store.
- Added `reserveCounter(domain,key,minimum)`: atomically reserves the next integer using `mutate`.
- The self-test covers multi-domain mutation, deliberate abort/rollback, concurrent writes and counter reservations, snapshot/restore, stale-record removal, preservation of unrelated domains, empty-domain restore, and cleanup.
- The concurrent mutation verification was hardened to avoid a false failure when a later valid transaction commits before an earlier transaction's post-commit read-back. The test separately verifies the final counter and uniqueness/monotonicity of reservations.
- The lab enforces exact expected build IDs and refuses to report success if checks are missing or the loaded module does not match the expected build.

### Browser validation evidence

The user ran the lab in iPhone Safari and returned the complete output:

- `ok: true`
- All 12 expected checks were `true`.
- `missingChecks: []`
- `missingOrFailedChecks: []`
- `unexpectedChecks: []`
- `localStorageAccessed: false`
- `buildMatches: true`
- `reportComplete: true`
- `appCutover: false`

This closes the isolated repository-primitive validation stage only.

### Important test boundary

These are synthetic repository tests, not live app workflows. They do not prove the current invoice-number business rules, Accounting/Projects synchronization, app backup/restore, app startup, or Safari application integration. No application file is imported or modified by this test. No backup was imported; no LocalStorage key was read or changed; no app cutover occurred.

## 9. Next stage — complete source audit before application integration

The repository primitive stage is passed. The next permitted work is a read-only, exhaustive audit of the current v250 application source and its dependencies, followed by a revised integration specification.

1. Reconcile all LocalStorage access sites in `index.html`, `storage-foundation.js`, and any dynamically loaded/inline scripts. Include direct calls, aliases, bracket notation, indirect wrappers, reads, writes, deletes and startup side effects.
2. Classify every access as core business data, preferences, reports, diagnostics, support drafts, migration/backup/restore, recovery, or disposable test instrumentation.
3. Trace each persistence function to all callers and event handlers. Record which callers currently assume synchronous return values and the async conversion required.
4. Identify every multi-record business operation and specify its atomic envelope(s), failure handling, user-visible success timing and recovery behavior.
5. Reconcile the v6 approved backup mapping with the canonical envelope model. Do not infer missing auxiliary data from stale browser storage.
6. Define the asynchronous bootstrap barrier, schema validation, no-fallback behavior, read/write parity gates and browser test matrix.
7. Do not edit `index.html`, connect the app to the repository, import v6, modify LocalStorage, or perform cutover during this audit stage.

The application source remains unchanged at blob SHA `f6bdb6a31fd9e424ca0464b5fb725c4ad0fb2315`. The repository module is still not referenced by `index.html`. Work remains limited to the existing `release239` branch; production `main` and all existing user data remain out of scope.


## 10. Read-only application storage audit — pass 1 (inventory and workflow tracing)

Reviewed the unchanged v250 application source and its two loaded support scripts on `release239`:

- `index.html`: blob `f6bdb6a31fd9e424ca0464b5fb725c4ad0fb2315`, 647,160 characters.
- `storage-foundation.js`: blob `63cffe890c6aacc860eb696deeb33a555a4eb66f`, 39,463 characters.
- `version-manager.js`: blob `39da652c2cec49d62b4b45236d2a40a8db411540`, 18,094 characters.

### Static inventory (source-text counts; not unique workflows)

| Source | Direct LocalStorage method-call expressions | Other observations |
|---|---:|---|
| `index.html` | 93 | 6 `window.localStorage` references; 13 declarations assigning a LocalStorage expression to an alias; no `indexedDB` reference. |
| `storage-foundation.js` | 8 | 7 LocalStorage alias declarations/references in migration, inventory and verification helpers; 3 IndexedDB references. |
| `version-manager.js` | 0 | No direct LocalStorage or IndexedDB references in this source scan. |

The counts overlap conceptually: a direct method call may also be included in an alias-containing function. They must not be added together as if they were independent data paths. No bracket-notation `['localStorage']` access was found in these three files by the initial pattern scan. Dynamic evaluation, computed aliases and external browser extensions are outside this source-only inventory.

### Application workflow map from traced functions

| Area | Current functions / behavior | Migration requirement |
|---|---|---|
| Accounting bootstrap | `loadDB()` reads the Accounting JSON envelope synchronously. | Replace with validated async read before UI readiness; preserve integrity-error lock. |
| Accounting persistence | `persist()` writes and reads back the Accounting envelope synchronously; callers use boolean success/failure. | Convert definition, all callers and event handlers to await durable commit. Do not display success or render dependent state before commit. |
| Invoice sequence | `highestSharedRecordNumber()`, `reserveRecordNumber()`, `cleanupUncommittedInvoiceNumbers()`, `resetStaleSequenceOnlyWhenNoSavedRecords()`. | Sequence reservation and envelope updates must share a transaction. Startup cleanup must not run against defaults or before validated canonical data is loaded. |
| Invoice lifecycle | Create/update/delete, payment status, diagnostic and orphan cleanup paths call `persist()`; some flows also update invoice-linked accounting entries. | One canonical Accounting envelope commit per logical operation; restore prior in-memory state on abort; audit every event handler for ignored return values. |
| Projects | `prLoad()` and `prPersist()` synchronously load/save the whole nested workspace; many project, subproject, worker, partner, company and job handlers depend on boolean return values. | Keep the entire workspace envelope canonical; convert every caller to async and preserve rollback behavior. |
| Project/accounting sync | Startup cleanup and project-financial sync helpers can update Accounting data after inspecting project records. | Define exact cross-domain transaction boundary and ensure no partial Accounting/Projects update. Preserve existing business rules; do not infer new synchronization. |
| Contracts | `ctRead()` / `ctWrite()` synchronously read, validate, write and verify the contract list; save/delete/render paths call them. | Async read/write with integrity lock and commit confirmation before success. |
| Full backup/restore | `backup()` reads Accounting, Projects and Contracts from separate synchronous storage calls; `restore()` validates and writes/removes multiple keys with rollback helpers. | Replace with one consistent multi-envelope snapshot and one atomic validated restore; preserve current merge/replace semantics only after explicit regression tests. |
| Factory reset | `factoryResetFinalConfirm()` snapshots/recovery-reads and removes several app keys. | Separate recovery snapshot and reset marker transaction; do not remove or mutate legacy LocalStorage during migration/cutover. Keep explicit confirmation and test rollback. |
| Preferences/language | `currentAppLang()`, `applyAppLanguage()`, `reportArchiveLanguage()` read/write language and preference-version values. | Load and validate preferences during async bootstrap; do not write defaults before canonical data validation. |
| Reports | `refreshReport()`, report archive/settings/workflow/email/notification helpers read report settings and language. | Inventory report keys and all call sites; assign explicit repository domains and decide which values are included in a future complete backup. |
| Monitoring/diagnostics | `monitorReadLog()`, `monitorWriteLog()`, `monitorContext()`, self-check and diagnostic export use LocalStorage. | Best-effort bounded diagnostics; diagnostic write failure must not fail business saves. Exclude synthetic self-test data from user migration. |
| Support | `submitHelpContact()` stores support/contact draft state. | Preserve draft semantics and sent/not-sent state; classify whether it belongs in user backup v7. |
| Launcher/profile | `syncLauncherBrand()`, `ctProfile()` and project profile helpers access persisted profile data. | Resolve canonical owner of profile/logo; avoid duplicated authoritative copies. |

### Critical synchronous assumptions confirmed

The source has 18 textual occurrences of `persist(` (including its definition), 30 of `prPersist(` (including its definition), and 3 of `ctWrite(` (including its definition). Existing callers use synchronous truthy/falsy branches, and some calls intentionally ignore the result. This means replacing storage calls alone is unsafe: all callers, event handlers, startup sequencing, and dependent render/alert actions need coordinated async conversion.

Startup currently calls `loadDB()`, then isolation cleanup and invoice-sequence cleanup/reset routines, then `prLoad()`, followed by additional project/accounting synchronization and launcher setup. The async bootstrap must gate all these operations and classify each startup repair before it is allowed to persist.

### Remaining audit work (not yet complete)

1. Resolve every one of the 13 `index.html` LocalStorage aliases and all 7 `storage-foundation.js` alias declarations to the exact underlying operation and classify read/write/delete/inventory/verification.
2. Enumerate all report, preferences, monitor and support key constants and trace every reader/writer.
3. Trace every `persist()`, `prPersist()` and `ctWrite()` call to its enclosing function/event callback, including ignored return values and rollback branches.
4. Review all dynamic script creation/imports and any storage access through computed property names or wrappers.
5. Reconcile the eight `storage-foundation.js` accesses individually with the earlier manifest's count and label each migration-only, inventory-only or normal-runtime.

No app code, LocalStorage value, browser database, backup or production branch was changed by this audit. The repository adapter remains unreferenced by the app. Continue only on `release239`; do not import v6 or perform cutover during this audit.


## 11. Storage-key and alias audit — pass 2

### Application keys identified in `index.html`

The source contains 17 distinct literal keys in the `tha_test226_*` namespace. This list is a source-code inventory, not evidence that every key currently exists in the user's browser:

| Key | Initial classification | Migration treatment |
|---|---|---|
| `tha_test226_accounting_v1` | Core Accounting envelope | Canonical `accounting/main`; v6 is the approved source for migration. |
| `tha_test226_projects_v1` | Core Projects workspace | Canonical `projects/workspace`; v6 approved source. |
| `tha_test226_contracts_v1` | Core Contracts envelope | Canonical `contracts/main`; v6 currently has an empty contract array. |
| `tha_test226_invoice_sequence_v1` | Business sequence metadata | Must be reconciled from validated invoice/income records and explicit approved metadata; never import stale browser value. |
| `tha_test226_invoice_sequence_cleanup_v1` | Startup cleanup marker | Reconstruct/redefine under repository schema; do not treat as user business data. |
| `tha_test226_empty_invoice_sequence_reset_v229` | Startup/test reset marker | Legacy implementation marker; do not migrate as authoritative data. |
| `tha_test226_isolation_test_record_cleanup_v1` | Isolation-test cleanup marker | Disposable test instrumentation; exclude from user data migration. |
| `tha_test226_app_language_v1` | User preference | Include only under explicit preferences/v7 policy; v6 does not establish its value. |
| `tha_test226_app_language_pref_version_v1` | Preference migration/version marker | Recreate using a documented preference schema; not a user-data source. |
| `tha_test226_monitor_log_v1` | Local diagnostics/activity log | Best-effort diagnostics; retention and backup policy required; do not source from stale LocalStorage. |
| `tha_test226_report_archive_v1` | User report archive | Dedicated report envelope; determine whether archive is user data and whether v7 backup includes it. |
| `tha_test226_report_notifications_v1` | Report notification state | Dedicated report envelope; define expiry/retention and backup policy. |
| `tha_test226_report_settings_v1` | Report preferences/configuration | Dedicated report envelope; preserve only from a specifically approved source. |
| `tha_test226_report_workflow_v1` | Report workflow state | Dedicated report envelope; define recovery and backup policy. |
| `tha_test226_report_email_settings_v1` | Report recipient configuration | Sensitive operational preference; preserve only through explicit v7 scope and consent. |
| `tha_test226_help_contact_drafts_v1` | Support/contact drafts | Preserve pending-local-only drafts if user data policy requires; never treat as sent. |
| `tha_test226_factory_reset_recovery_v1` | Recovery snapshot | Do not migrate as active business data; retain a separate immutable recovery design and explicit restore path. |

### LocalStorage alias resolution

The 13 application aliases are not 13 additional stores. They resolve to:

- `raw` in `loadDB()`: raw Accounting JSON read.
- `lang` in report language lookup: language preference value.
- `rawAccounting`, `rawContracts`: pre-restore source snapshots for Accounting and Contracts.
- `check`: value read-back inside `safeWrite()` during restore.
- `checkDB`: restore verification after rollback/write sequence.
- `raw` in invoice diagnostic: Accounting envelope read for invoice cross-check.
- `raw` in `prLoad()`: Projects workspace read.
- `oldRaw` in project restore: prior Projects raw payload for rollback.
- `checkRaw` in `ctWrite()`: Contracts write read-back.
- `ok` in monitor self-check: temporary diagnostic test value.
- `prefVersion`, `saved` in language bootstrap: preference-version and selected-language reads.

The seven `storage-foundation.js` aliases are local variables holding enumerated keys or raw values during legacy inventory, snapshot, migration and verification. They are not independent normal-runtime app data flows.

### Exact classification of the eight storage-foundation calls

| Function | Calls | Classification | Boundary |
|---|---|---|---|
| `enumerateLegacyKeys()` | `localStorage.length`, `localStorage.key(i)` | Migration inventory | Reads key names only; does not write or delete. |
| `snapshotLegacyData()` | `getItem(key)` | Migration snapshot | Reads legacy values into an explicit snapshot; not approved as a source for this v250 migration. |
| `migrateLegacyData()` | `getItem(key)` | Migration operation | Reads legacy values before staging them into the foundation KV store; prohibited as a source for the approved v6 migration. |
| `verifyMigration()` | `getItem(key)` | Migration verification | Compares legacy values to staged KV values; read-only verification, not canonical app runtime. |
| `inspectStorageInventory()` | `length`, `key(i)`, `getItem(key)` | Diagnostic inventory | Reads key names and value metadata for local diagnostic output. |
| `inspectMigrationSources()` | `length`, `key(i)`, `getItem(key)` | Diagnostic inventory/reconciliation | Reads all current-origin keys for a local diagnostic; not an approved migration source. |

Thus the eight direct call expressions are accounted for as migration/inventory/verification helpers in this file, not as the app's canonical runtime persistence adapter. However, these helpers still access LocalStorage and must be disabled, isolated or explicitly retained as read-only diagnostic tools after cutover; they cannot be allowed to silently migrate old keys into the new canonical database.

### Additional dynamic interception behavior

The application includes a LocalStorage method wrapper that observes selected `setItem` and `removeItem` operations and records monitor events for non-exempt keys. This means a final audit cannot rely only on direct source call counts: it must review patched prototype methods and ensure IndexedDB operations are not routed through a LocalStorage compatibility shim. The wrapper must be removed or made strictly diagnostic and non-authoritative after cutover.

### Audit status

Pass 2 has identified all 17 literal app namespace keys and assigned initial treatment, resolved all 13 `index.html` aliases, and classified the eight `storage-foundation.js` direct access expressions by function. The next pass must trace report module read/write helpers and all callers of the synchronous persistence functions, including ignored return values. This is still a read-only audit; no application source or user data has been changed.
