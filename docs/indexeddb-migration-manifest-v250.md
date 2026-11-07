# The Handyman Accountancy — IndexedDB Migration Manifest

- Baseline: approved v250 test application
- Repository: `Thehandymanjob/accountancy-test`
- Working branch: `release239` (existing branch only)
- Production repository/branch: `Thehandymanjob/accountancy` / `main` — out of scope
- Status: design and mapping specification; **not an execution authorization**
- Data authority: approved complete-user-data backup v6 only
- Backup file SHA-256: `07b6170db9169e3b59d0b4527b88e26d589bd18c178ec9a1b1975b55f403db90`

## 1. Safety invariants

1. Do not read old LocalStorage namespaces as migration sources or merge them into the approved v6 data.
2. Do not write to, clear, rename, or delete any existing LocalStorage key during design, staging, or validation.
3. Do not modify `Final_backup.json` or the approved v6 backup.
4. Do not reuse or overwrite `the_handyman_accountancy_test226`, `the_handyman_accountancy_roundtrip_v6`, or any other existing database.
5. Use a new isolated database name for the v250 migration work: `the_handyman_accountancy_v250_idb`.
6. Keep the application on its current storage adapter until the complete read/write parity test passes and a separate explicit cutover approval is received.
7. Work only in the existing `release239` branch. No new branches and no production changes.
8. Every write stage must be idempotent or have a verified rollback. No cleanup/deletion phase is part of this manifest.

## 2. Approved backup v6: observed structure

Backup root keys: `app`, `backupType`, `version`, `exportedAt`, `data`, `projects`, `contracts`.

- `app`: The Handyman Accountancy
- `backupType`: `complete-user-data`
- `version`: 6
- `exportedAt`: `2026-11-07T08:35:24.557Z`
- `data` keys: `entries`, `customers`, `invoices`, `customExpenseCategories`, `settings`, `thirdPartyTransactions`
- `projects` keys: `projects`, `workers`, `partners`, `contractors`, `companies`, `companyJobs`, `profile`, `current`, `guide`, `currentSubproject`, `profitReportProjectId`
- `contracts`: array

Observed normalized counts from the approved backup:

| Domain | Count |
|---|---:|
| customers | 1 |
| projects | 8 |
| invoices | 2 |
| contracts | 0 |
| accounting entries | 22 |
| project receipts | 9 |
| project expenses | 1 |
| workers | 1 |
| partners | 1 |
| contractors | 1 |
| companies | 1 |
| company jobs | 0 |
| custom expense categories | 1 |
| third-party transactions | 0 |
| accounting settings | 1 |
| project metadata | 1 |
| record-order metadata | 1 |
| embedded images | 8 |

These are backup-v6 observations, not counts from the current browser's LocalStorage or the existing test IndexedDB.

## 3. Proposed target database and stores

Database: `the_handyman_accountancy_v250_idb`.

The existing v233 foundation currently creates a different database (`the_handyman_accountancy_test226`) and schema version 4. It must not be silently repointed or reused. Build a new, explicitly named foundation/configuration for this migration.

| Target store | Source in approved v6 | Mapping rule / notes |
|---|---|---|
| `customers` | `data.customers[]` | Preserve each record and stable ID exactly. |
| `invoices` | `data.invoices[]` | Preserve invoice number, customer/project references, nested items, dates, status, payment fields and unknown fields. |
| `accountingEntries` | `data.entries[]` | Preserve all fields and IDs; do not recalculate amounts or rewrite dates. |
| `accountingSettings` | `data.settings` | One settings record; retain all keys and values. |
| `customExpenseCategories` | `data.customExpenseCategories[]` | Preserve original values and order; assign deterministic storage IDs only if source entries have no IDs, with source index retained. |
| `thirdPartyTransactions` | `data.thirdPartyTransactions[]` | Preserve all fields and IDs. |
| `projects` | `projects.projects[]` | Preserve projects, subprojects, financial values, relationships, photos and unknown fields. |
| `projectReceipts` | nested project receipt/ledger data | Extract only after exact source field/path has been confirmed; preserve parent project and subproject IDs. |
| `projectExpenses` | nested project expense/ledger data | Extract only after exact source field/path has been confirmed; preserve parent project and subproject IDs. |
| `workers` | `projects.workers[]` | Preserve IDs and all fields. |
| `partners` | `projects.partners[]` | Preserve IDs and all fields. |
| `contractors` | `projects.contractors[]` | Preserve IDs and all fields. |
| `companies` | `projects.companies[]` | Preserve IDs and all fields. |
| `companyJobs` | `projects.companyJobs[]` | Preserve IDs and all fields. |
| `contracts` | root `contracts[]` | Preserve as records; approved v6 currently contains zero. |
| `projectMetadata` | `projects.profile` and workspace state | Preserve profile/logo and workspace selectors separately from project records. |
| `recordOrder` | source ordering and invoice sequence metadata, if present in v6 | Do not infer a sequence from stale LocalStorage. Derive only from validated backup records and explicit v6 metadata. |
| `auditLog` | migration audit events | New migration audit only; do not import unrelated legacy logs. |
| `legacySnapshots` | exact approved v6 source snapshot | Store immutable raw backup snapshot and SHA-256 metadata; never use old browser keys as source snapshots. |
| `kv` | application metadata / compatibility values | Only non-record metadata with an explicit schema; not a catch-all for core business records. |

**Important mapping gate:** the current count summary reports project receipts and expenses, but the exact nested field paths and ownership rules must be confirmed from the v6 JSON before implementing normalized extraction. Do not invent a mapping or split records based on guessed field names.

## 4. Application state requiring an explicit v7 backup policy

The v6 backup does not show dedicated root fields for the following app state. Their availability in v6 is therefore not established:

- Monitor activity log and diagnostics
- Report archive, report settings, report workflow and report email settings
- Report notifications
- Language preference and preference-version marker
- Help/contact drafts
- Invoice sequence cleanup markers and reset markers
- Factory-reset recovery snapshot
- Other future app preferences and UI state

These are not to be sourced from old LocalStorage namespaces. Before v7 is finalized, define which of these are user data worth preserving, which are disposable diagnostics, and which are safely reconstructable from approved v6 records. Do not silently claim they were migrated from v6.

## 5. Schema and identity rules

- Preserve source IDs exactly when valid and unique within their target store.
- Never silently drop malformed records or duplicate IDs. Stop the batch, report exact store/index and issue, and require a deliberate resolution.
- Do not generate replacement IDs during a production data migration without a documented mapping table linking original source position/value to generated ID.
- Preserve unknown object fields, nulls, empty strings, zero values, nested arrays and object structure.
- Preserve array ordering using explicit order metadata where the application depends on it.
- Preserve image data exactly at first migration. Do not resize, recompress, or convert image formats.
- Keep parent-child relationships explicit; validate every project/subproject and invoice/customer reference.
- Amounts are stored as provided. No currency conversion, rounding, price normalization, or recalculation during migration.

## 6. Required migration phases

| Phase | Action | Writes allowed? | Exit condition |
|---|---|---|---|
| M0 | Freeze baseline and verify approved backup SHA-256 | No | Exact source file and branch baseline recorded |
| M1 | Finalize field-level source-to-target mapping from v6 | No | Every field/path mapped or explicitly excluded |
| M2 | Create isolated database and schema | New DB only | Correct DB name/version/store list; existing DBs untouched |
| M3 | Stage immutable v6 snapshot | New DB only | Raw bytes/hash and metadata read back exactly |
| M4 | Import typed records in bounded transactions | New DB only | No dropped/duplicate IDs; all transaction writes verified |
| M5 | Reconcile all stores and relationships | Read-only | Exact counts, IDs, canonical payload equality, image hashes and totals |
| M6 | Exercise app repository adapters in isolated harness | New DB only | CRUD, reload, backup/restore and failure tests pass |
| M7 | Full app storage cutover in test branch | Only after explicit approval | App reads and writes IndexedDB exclusively; no hidden LocalStorage fallback |
| M8 | Browser regression and recovery tests | Test DB only | iPhone Safari reload/offline/large images/backup/restore pass |
| M9 | Production release | Only after separate explicit approval | Not included in current authorization |

## 7. Mandatory acceptance tests

1. SHA-256 of immutable staged backup snapshot equals approved source SHA-256.
2. Every imported store has exact expected record count.
3. Every record ID set matches the source mapping; no silent skips.
4. Canonical JSON equality for every source payload/record, except explicitly documented storage envelope fields.
5. All image payload hashes match; all 8 embedded images accounted for.
6. All project and subproject links resolve.
7. All invoice/customer links resolve.
8. Accounting totals and project receipt/expense totals match source without recalculation.
9. Invoice numbering remains monotonic and no duplicate invoice numbers are introduced.
10. Backup export from IndexedDB can be restored into a second isolated test database and round-trips exactly.
11. Simulated quota error, transaction abort, reload during operation and interrupted migration leave source backup intact and target marked incomplete.
12. Test app does not write business data to LocalStorage after cutover; any remaining LocalStorage usage is explicitly documented and limited to non-persistent runtime necessities.
13. The app never reports a successful save until the IndexedDB transaction commits and read-back verification succeeds.

## 8. Current known blockers / facts

- The v250 `index.html` still reads and writes core Accounting, Projects and Contracts through LocalStorage.
- Report workspace, language preferences, monitor log, invoice sequence, support drafts, recovery and related helpers also use LocalStorage directly.
- The existing IndexedDB foundation is isolated and does not automatically back the app.
- Existing accounting/project migration modules are prototypes, not an application cutover.
- The current test IndexedDB has earlier test artifacts and must not be treated as the approved v6 staging database.
- The separate v6 roundtrip database has already passed an isolated roundtrip test and must not be overwritten or deleted.
- The source-reconciliation browser report is still pending; it is useful for understanding current test environment only, not for choosing migration source data.

## 9. Current authorization boundary

Authorized now: documentation and read-only inspection; creation of isolated test-only code on `release239` when separately appropriate.

Not authorized by this manifest: modifying production `main`, changing live app persistence, importing data into a live app database, deleting LocalStorage, clearing IndexedDB, overwriting existing databases/backups, or releasing a cutover.

---
Generated as a working specification. This document records observed facts separately from proposed design and unresolved mappings.


## 10. Field-level inspection of approved backup v6 (completed)

The approved JSON was inspected directly. Its top-level structure is exactly:
`app`, `backupType`, `version`, `exportedAt`, `data`, `projects`, `contracts`.

### Accounting payload

`data` contains exactly:
- `entries[]`: 22 records. Observed entry fields include `id`, `type`, `date`, `amount`, `method`, `category`, `reference`, `notes`, `invoiceId`, `createdAt`.
- `customers[]`: 1 record. Observed fields: `id`, `name`, `phone`, `address`, `workAddress`, `email`.
- `invoices[]`: 2 records. Observed fields include `id`, `number`, `date`, `customerId`, `customerName`, `phone`, `billingAddress`, `workAddress`, `description`, `qty`, `unitPrice`, `vat`, `status`, `notes`, `historical`, `paymentStatus`, `paymentDate`, `paymentMethod`, `items[]`, `updatedAt`. Nested item fields must be preserved as-is.
- `customExpenseCategories[]`: 1 string value (not an object record).
- `settings`: object with `businessName`, `ownerName`.
- `thirdPartyTransactions[]`: 0 records.
- Root `contracts[]`: 0 records.

### Projects payload

`projects` contains:
- `projects[]`: 1 project record.
- `workers[]`, `partners[]`, `contractors[]`, `companies[]`: 1 record each.
- `companyJobs[]`: 0 records.
- `profile`: object with `businessName`, `ownerName`, `phone`, `email`, `logo`, `paymentDetails`.
- `current`: project ID string.
- `guide`: language string (`en`).
- `currentSubproject`: null.
- `profitReportProjectId`: project ID string.

The single project has fields:
`id`, `name`, `customer`, `address`, `phone`, `price`, `contract`, `partnerId`, `share`, `notes`, `photo`, `status`, `created`, `income[]`, `expenses[]`, `wages[]`, `tools[]`, `food[]`, `materials[]`, `hasSubprojects`, `subprojects[]`, `partnerShare`, `contractors[]`.

There are 7 subprojects. Each carries its own ID, name, price and one or more ledger/category arrays; observed keys include `income`, `expenses`, `wages`, `tools`, `food`, `materials`, and `photo`. Preserve every subproject as a nested child or as a normalized row with an explicit `projectId` and stable `subprojectId`; never flatten away its parent relationship.

### Confirmed project ledger mapping

The backup has 9 receipt/income rows and 1 expense row, all nested under subprojects:

| Parent subproject | Income rows | Expense rows |
|---|---:|---:|
| Roof (first) | 4 | 1 |
| Top floor | 2 | 0 |
| Porch roof | 1 | 0 |
| Plumbing | 1 | 0 |
| Roof (second) | 1 | 0 |
| Basement | 0 | 0 |
| Bathroom | 0 | 0 |
| **Total** | **9** | **1** |

The project-level ledger arrays (`income`, `expenses`, `wages`, `tools`, `food`, `materials`) are empty in this backup. All nine receipt records and the single expense must therefore be traced to their owning subproject during normalization.

Observed receipt fields vary. Examples include `id`, `description`, `amount`, `date`, `method`, `reference`, `receiptType`, and `receiptImage`. Observed expense fields include `id`, `date`, `amount`, `description`, `reference`, `category`, `contractorId`, and `contractorName`. Preserve optional/missing fields and empty strings exactly; do not force all records into one narrowed schema.

Observed totals for this backup only:
- Subproject receipt amount total: £12,200.
- Subproject expense amount total: £280.
- These totals are reconciliation checks, not values to write back over the project price or ledger records.

### Image accounting correction

There are **8 image payloads in total**:
- 1 project profile logo (`projects.profile.logo`).
- 1 main project photo (`projects.projects[0].photo`).
- 6 non-empty subproject photos (the Basement photo is an empty string).

The prior description of “8 embedded images” is correct only when the profile logo is included. The project workspace itself has 7 non-empty photos (main project + 6 subprojects). Each image must be hashed and verified at its original path; empty photo strings remain empty strings.

### Required mapping decision before implementation

The source backup stores receipts and expenses nested inside subprojects. The existing typed target stores `projectReceipts` and `projectExpenses` use `id` as keyPath. Normalization is permissible only if each child row retains:
- original child `id`;
- `projectId`;
- `subprojectId`;
- original category/ledger type;
- original row payload without field loss.

The parent project record must also retain the original nested arrays or a byte/canonical-equivalent representation until the complete normalized round-trip is proven. Avoid dual-write ambiguity: designate one canonical representation and document a deterministic rehydration function before app cutover.

**Unresolved:** the application’s actual runtime calculations and edit/delete flows must be checked to determine whether they expect nested arrays as canonical storage. Until that code-path review is complete, keep the project object intact in the staging payload; do not make normalized child stores the only source of truth.



## 11. Runtime project persistence review: canonical model decision

The v250 application source was inspected at the actual project load/save boundary:

- `prLoad()` reads the complete Projects workspace object from `tha_test226_projects_v1`.
- `prPersist()` serializes and writes the complete `prDB` workspace object.
- The workspace object contains `projects[]`, and each project contains its own subprojects and nested ledger arrays.
- Project load-time compatibility logic iterates over each project and its subprojects; it mutates a cloned candidate and commits only after verification.
- The application's project editing and reporting logic is therefore built around the complete nested workspace object, not around independently loaded receipt/expense tables.

**Decision for first cutover:** keep the complete Projects workspace payload as the canonical record in IndexedDB (one envelope under a dedicated `kv` key, or a single workspace record with exact JSON preservation). Do not make `projects`, `projectReceipts`, or `projectExpenses` the only canonical representation during the first migration.

Typed child stores may be populated later as verified secondary indexes/projections, but only if:
1. each row carries its original ID, project ID, subproject ID and ledger type;
2. a deterministic projection/rebuild process exists;
3. the application continues to use one authoritative canonical workspace;
4. projection writes are atomic with the canonical workspace update, or can be safely rebuilt;
5. projections are checked against the canonical nested payload and are never independently edited.

This avoids a dangerous dual-source-of-truth condition in which an edit changes a normalized receipt but leaves the nested project ledger stale (or vice versa).

The approved backup v6 therefore maps as follows for the first safe import:
- Preserve the entire `projects` root object exactly, including `current`, `guide`, `currentSubproject`, `profitReportProjectId`, `profile`, nested ledgers and all images.
- Preserve the entire `data` root object exactly, including accounting arrays, settings, custom categories and third-party transactions.
- Preserve the root `contracts[]` exactly.
- Keep a separately hashed immutable copy of the complete backup JSON.

The above is a source-preserving import design. It does not yet establish that the live app has been switched to IndexedDB; that requires replacing every persistence call site and testing all user workflows.


## 12. Full v250 index.html LocalStorage call-site inventory

A source scan of the complete v250 `index.html` (647,160 characters; blob SHA `f6bdb6a31fd9e424ca0464b5fb725c4ad0fb2315`) found **93 direct LocalStorage method call expressions** across the application source. These are call expressions, not 93 separate data domains; several are repeated within transactional restore/reset/rollback routines.

The file contains 17 distinct literal `tha_test226_*` storage keys:

1. `tha_test226_accounting_v1`
2. `tha_test226_projects_v1`
3. `tha_test226_contracts_v1`
4. `tha_test226_monitor_log_v1`
5. `tha_test226_invoice_sequence_v1`
6. `tha_test226_invoice_sequence_cleanup_v1`
7. `tha_test226_empty_invoice_sequence_reset_v229`
8. `tha_test226_app_language_v1`
9. `tha_test226_app_language_pref_version_v1`
10. `tha_test226_report_archive_v1`
11. `tha_test226_report_notifications_v1`
12. `tha_test226_report_settings_v1`
13. `tha_test226_report_workflow_v1`
14. `tha_test226_report_email_settings_v1`
15. `tha_test226_help_contact_drafts_v1`
16. `tha_test226_factory_reset_recovery_v1`
17. `tha_test226_isolation_test_record_cleanup_v1`

### Call-site groups confirmed in source

| Area / function group | Observed responsibility | Migration requirement |
|---|---|---|
| `loadDB`, `persist` | Accounting payload read/write and read-back check | Replace with awaited repository calls; preserve existing integrity lock and save-failure UI. |
| `updateMainExpenseFields` | Reads project contractor directory while creating accounting expense | Read from canonical project workspace repository. |
| `reportArchiveLanguage`, `currentAppLang`, language initialization/save | Reads/writes language and preference version | Persist in app settings; retain exact fallback and language validation behavior. |
| `has`, `syncLauncherBrand`, `ctProfile` | Reads project workspace/profile and logo | Read canonical project workspace; preserve image bytes and fallback behavior. |
| `backup` | Reads accounting, project and contract payloads to build backup | Export one consistent IndexedDB snapshot, not a mixture of live in-memory and stale browser storage. |
| `restore`, `safeWrite`, `mergeById` | Multi-domain restore, rollback and merge operations | Implement one atomic multi-store transaction or a staged import with verified rollback; preserve current duplicate/merge semantics only after explicit test coverage. |
| `factoryResetFinalConfirm` | Saves recovery snapshot and removes/reset multiple data keys | Must become an explicit transaction with a recoverable pre-reset snapshot; no LocalStorage deletion after cutover. |
| `removeKnownIsolationTestRecord` | Removes a known test-only record marker | Keep strictly test-only; do not let it touch business records. |
| `cleanupUncommittedInvoiceNumbers`, `resetStaleSequenceOnlyWhenNoSavedRecords`, `highestSharedRecordNumber`, `reserveRecordNumber` | Invoice number allocation, cleanup and consistency | Serialize number reservation to avoid duplicates across tabs; preserve issued numbers and cleanup audit semantics. |
| `updateInvoiceStatusDiagnostic`, `removeOrphanedInvoiceIncome` | Invoice/accounting cross-record consistency | Move into coordinated repository operations; validate both sides before commit. |
| `prLoad`, `prPersist`, `prSaveProject`, `prToggleProjectCompletion`, `prRestore` | Projects workspace load/save, completion status and restore | Canonical whole-workspace repository; await commit before showing success or refreshing dependent views. |
| `ctRead`, `ctWrite` | Contract list load/save with rollback | Repository adapter must retain validation, exact previous-value rollback and success flag semantics. |
| Help-contact draft handlers | Saves local-only support drafts | Preserve draft state in IndexedDB; continue to label as not sent. |
| `monitorReadLog`, `monitorWriteLog`, `monitorContext`, `exportDiagnosticReport`, `runMonitorSelfCheck` | Diagnostic event log, storage status and exported diagnostics | Store monitor data separately from business ledger; diagnostics must not make core saves fail. Self-check must test IndexedDB, not LocalStorage. |
| Wrapped `persist` monitor hook | Compares before/after accounting snapshots for activity logging | Replace snapshot reads with repository snapshots; do not report save success before transaction commit. |
| Report helper `load` / `save` | Generic report archive/settings/workflow/email/notification persistence | Identify each caller and key; route all through typed report/app-settings repository methods. |

### Important cross-domain behavior

- Invoice sequence logic is not merely a preference: it coordinates invoice numbering and accounting entries. Number reservation must be concurrency-safe and transactionally consistent.
- Invoice status changes and orphaned invoice-income cleanup touch both invoice and accounting records; separate independent writes risk partial updates.
- Backup and restore cover accounting, projects and contracts as a group. A cutover cannot be considered complete if only ordinary save/load paths are migrated but backup/restore remains LocalStorage-based.
- Factory reset has a recovery snapshot dependency. The reset and its recovery point must be designed together.
- Monitor logging is used by storage failure handling itself. Avoid recursive failure loops: monitor failure must never conceal or overwrite the original business-data save error.
- The app has runtime in-memory state (`db`, `prDB`) as well as persistent state. Repository calls must be asynchronous and UI success must wait for transaction completion/read-back, not merely update in-memory objects.

### Remaining audit boundary

This scan covers the monolithic `index.html`. Before claiming the whole application is free of direct LocalStorage access, inspect every separately loaded JavaScript file and any inline scripts added by service worker/update infrastructure. Also search for bracket notation, aliases such as `const storage = localStorage`, and indirect helper wrappers. The current finding is **93 direct method-call expressions in index.html**, not a proof that the complete deployed origin has no other access.
