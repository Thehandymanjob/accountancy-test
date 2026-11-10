# THA v264 full-application migration audit

Date: 2026-11-10
Target repository: `Thehandymanjob/accountancy-test`
Working branch: `main`
UI source: root `index.html` (v262)
Isolated working copy: `v264-app/index.html`
Production repository: NOT TOUCHED

## Status

**NOT READY FOR USER OPERATION.** The copied v262 interface is present, but its persistence and workflow code still uses legacy browser storage. The v264 IndexedDB controllers are separate modules and have not yet replaced the legacy UI data paths. The startup coordinator is not loaded by the working HTML and intentionally does not activate the UI.

## Confirmed legacy persistence entry points

| UI area | Current legacy path | Migration requirement |
|---|---|---|
| Accounting | `loadDB()`, `persist()`; `KEY` reads/writes LocalStorage | Await controller load/save/update; no shadow writes or fallback |
| Invoice/customer | Accounting `db`, invoice sequence key and synchronous callers | Convert every mutating handler to async; use atomic number reservation and workflow APIs |
| Projects/subprojects | `prLoad()`, `prPersist()`, completion and project backup use LocalStorage | Convert load/save and every project mutation to awaited Projects controller calls |
| Contracts | `ctRead()`, `ctWrite()`, `ctProfile()` use LocalStorage | Async contract controller and separate business-profile controller |
| Language/preferences | Language functions read/write LocalStorage | Support controller preference API |
| Reports/diagnostics | Archive, notification, settings and monitor log use LocalStorage | Support domains; preserve report output and print rendering |
| Backup/restore/reset | Existing portable backup and restore explicitly enumerate LocalStorage plus IndexedDB | Replace with complete v264 IndexedDB backup including all media; verify before restore/reset |
| Logo and receipt media | Legacy profile/project structures and backup code | Verify Blob/File/base64 preservation and include every media-bearing domain in full backup |
| Help/contact drafts | Legacy key `tha_test226_help_contact_drafts_v1` exists in old UI | Add an explicit v264 domain/controller and include in backup |
| External scripts | `storage-foundation.js`, `version-manager.js` referenced by HTML | Audit/copy only after checking their storage access and runtime dependencies |

## v264 module API facts

- Accounting controller: `initialize/load/save/update/addEntry/updateEntry/deleteEntry/saveCustomer/deleteCustomer/reserveInvoiceNumber`.
- Invoice workflow: `saveInvoice/markPaid/markUnpaid/softDelete/total`.
- Projects controller: async state CRUD, project/subproject CRUD, directories and project ledger records.
- Contracts controller: async load/save/add/update/remove/get.
- Business profile controller: async load/save/update; current profile stores logo as a string field.
- Support controller: preferences, preference metadata, diagnostics, reports, report notifications/settings/workflow and notifications.
- UI adapter: `startAll/loadAll` and async facades for each controller.
- Module bootstrap: separate `startAccounting/startProjects/startContracts/startBusinessProfile/startSupport` methods; it does **not** expose a `startAll` method.
- App storage registry currently has no `media` or `helpContactDrafts` domain.
- App storage `writeMany()` deliberately throws; report workspace save currently performs sequential independent writes, not an atomic multi-domain transaction.
- UI adapter currently rejects partial invoice payments and blocks project-to-accounting transfer. These are known functional gaps, not acceptable assumptions of parity.
- Project completion currently changes status only; it does not transfer project data to Accounting.
- Projects controller intentionally removes an empty profile object and rejects non-empty embedded profile data; profile must be moved to the separate Business Profile domain before saving.

## Startup coordinator check

`v264-app-bootstrap.js` is fail-closed and does not access LocalStorage. Its expected public methods were checked against the current module sources: storage `ready/health`, domain boundary `createScope`, app storage `initialize`, each domain `load`, recovery `create`, module bootstrap `startAll` (NOTE: this name is currently wrong on the module-bootstrap object), and UI adapter `startAll`.

**Required correction:** `HandymanModuleBootstrapV264` exposes five separate start methods, not `startAll`. The coordinator must call the five explicit module starts or use `HandymanUIAdapterV264.startAll()` without separately requiring a nonexistent method. Do not wire this coordinator into the HTML until corrected and tested.

## Mandatory cutover gates

1. Complete key/function inventory for all old storage and backup paths.
2. Add and test missing domains, especially media and help/contact drafts; ensure backup includes every registered domain.
3. Convert one vertical slice at a time to awaited IndexedDB APIs. No synchronous shim, LocalStorage shadow-write, silent fallback, or swallowed persistence error.
4. Add regression tests for create/read/update/delete, reload persistence, quota/blocked database errors, media round-trip, and exact backup/restore verification.
5. Verify all old UI actions still work, including partial invoice payments (if present in v262), project/subproject accounting, contractor/partner workflows, project completion/reopen, and explicit project-to-accounting transfer with duplicate prevention.
6. Keep all v262 CSS, layout, logo placement, report HTML/CSS, print dimensions, and font sizing unchanged. Compare before/after source and rendered print output.
7. Search final HTML and all loaded scripts for any LocalStorage/SessionStorage/cookie app-data access. Must be zero before release.
8. Only after all gates pass, enable startup and test the full app in Safari. Do not use production repo or replace the test repo root index.

## Immediate next implementation slice

Start with an exact mapping of accounting and invoice event handlers to the async controllers, including invoice numbering and customer IDs. Do not edit the main UI file until the handler map and missing API behavior are understood. The full v262 UI file remains unchanged in the root; `v264-app/index.html` is the isolated work copy.


## Progress update — 2026-11-10 (continued)

- Added `v264-app/v264-accounting-bridge.js`: async in-memory view-model bridge over IndexedDB controllers. It exposes initialize/refresh/getState/subscribe, entry CRUD, customer CRUD, invoice save/mark-paid/mark-unpaid/soft-delete, invoice number reservation, and settings updates. Mutating bridge actions are serialized; no Storage API access is present.
- Added `v264-app/accounting-invoice-check.html`: isolated browser verification for the bridge and accounting/invoice controllers. It blocks LocalStorage reads/writes during the test, checks Blob media round-trip, persistence on a fresh IndexedDB read, invoice full-payment lifecycle and synthetic cleanup.
- Corrected `v264-app/v264-app-bootstrap.js` to start modules through the actual `HandymanUIAdapterV264.startAll()` API. The module bootstrap itself exposes individual start methods only.
- The invoice UI inspected in v262 uses a binary paid/unpaid workflow; it does not expose a partial-payment amount field. The v264 full-payment restriction therefore matches the visible invoice form, but this still needs browser regression verification.
- No full UI cutover has occurred. `v264-app/index.html` remains unchanged; original root UI and production remain untouched.
- The new browser test has not yet been run by the user. Do not mark the accounting/invoice slice as passed until its JSON output confirms every check and synthetic cleanup.
