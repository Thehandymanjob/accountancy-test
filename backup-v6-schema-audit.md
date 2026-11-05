# Backup v6 — structural migration audit

Audit target: `Final_backup(4).json`  
Backup metadata: `The Handyman Accountancy`, `complete-user-data`, version 6, exported 2026-11-04T19:48:48.755Z.  
Scope: read-only structural inspection. No source bytes changed, no Safari LocalStorage/IndexedDB access, no import or app cutover.

## 1. Top-level shape

- `data`: accounting payload
- `projects`: project workspace, reference lists and profile
- `contracts`: saved contracts

### Accounting payload

| Collection / field | Count / shape |
|---|---:|
| entries | 22 |
| customers | 1 |
| invoices | 2 |
| customExpenseCategories | 1 |
| thirdPartyTransactions | 0 |
| settings | object: businessName, ownerName |

Entry records are not uniform: some contain `invoiceId`; some contain `number`; preserve optional fields as-is. Invoice records are also non-uniform: one contains `historical` and nested `items`, the other does not.

### Project workspace

| Collection / field | Count / shape |
|---|---:|
| projects | 1 |
| nested subprojects | 7 |
| workers | 1 |
| partners | 1 |
| contractors | 1 |
| companies | 1 |
| companyJobs | 0 |
| contracts | 1 |

Project workspace metadata also contains `profile`, `current`, `guide`, `currentSubproject`, and `profitReportProjectId`. Preserve these independently; they are not project records.

The project has no top-level income/expense rows in its own arrays. Its six receipts and one expense are nested under subprojects. Subproject records have different optional fields and must not be coerced into a fixed shape that drops absent or unknown fields.

## 2. Integrity checks

- Unique IDs within each populated top-level collection.
- No duplicate IDs across the inspected record collections, including nested receipt/expense records.
- Both invoice customer references resolve to the customer collection.
- Both accounting entries carrying `invoiceId` resolve to existing invoices.
- Project `partnerId` resolves to the partner collection.
- The expense's `contractorId` is blank; do not invent a contractor link.
- Project and contract customer values are not customer IDs. Do not silently convert name/text fields into foreign keys.

## 3. Financial values — keep ledgers separate

| Measure | Count | Total |
|---|---:|---:|
| Accounting income entries | 8 | £6,150.00 |
| Accounting expense entries | 14 | £1,151.22 |
| Project receipts | 6 | £6,200.00 |
| Project expenses | 1 | £280.00 |

These are distinct accounting and project measures. Do not reconcile them by overwriting one with the other. The two invoice records are both Issued and Paid and each has a corresponding accounting income entry.

Project pricing must use the established application rule: where subprojects exist, sum subproject agreed prices, including extra-work additions. The raw project `price` field is not the derived project total. In this backup, subproject base prices total £17,400 and the extra-work addition is £300, giving the established total of £17,700. Do not add receipts to the agreed price.

## 4. Date and image preservation

- Four project receipt records have an empty date string. Preserve each empty value exactly; never substitute the current date.
- Eight embedded JPEG data URIs are present: one project photo, six subproject photos, and one profile logo.
- Combined embedded image data is 1,416,428 decoded bytes (1,888,764 Base64 characters). Preserve exact data URI content and verify SHA-256 after staging.
- One subproject photo field is an empty string. Preserve it as empty; do not convert it to null or omit it.

## 5. Proposed non-destructive mapping to the existing schema-v4 stores

| Source | Proposed target | Handling |
|---|---|---|
| `data.entries` | `accountingEntries` | One record per entry; preserve `invoiceId`, `number`, optional and unknown fields |
| `data.customers` | `customers` | Preserve source IDs |
| `data.invoices` | `invoices` | Preserve nested `items` and optional fields |
| `data.customExpenseCategories` | `customExpenseCategories` | Use stable deterministic IDs in staging; retain original value/order |
| `data.thirdPartyTransactions` | `thirdPartyTransactions` | Empty collection remains empty |
| `data.settings` | `accountingSettings` | One settings record with original object intact |
| `projects.projects` | `projects` | Preserve parent project record; retain source ID |
| nested subprojects | `projects` plus parent metadata | Stage each subproject with its original ID and explicit parentProjectId/recordType; retain original nested source in snapshot |
| nested income/receipts | `projectReceipts` | Add parentProjectId and subprojectId without changing source fields |
| nested expenses | `projectExpenses` | Add parentProjectId and subprojectId without changing source fields |
| nested wages/tools/food/materials | `projectExpenses` | Preserve original source array name as a sourceType; do not merge amounts into another category |
| workers / partners / contractors / companies / companyJobs | matching stores | Preserve IDs and original fields |
| `projects.profile` and workspace selectors | `projectMetadata` | Store separately from project records |
| `contracts` | `contracts` | Preserve IDs and customer text; no guessed customer foreign key |
| original full JSON | `legacySnapshots` | Immutable raw source snapshot, byte length and hash |

The table is a staging proposal, not an executed migration. Any added linkage fields are staging metadata only; original source fields remain unchanged.

## 6. Required migration gates

1. Validate the complete v6 envelope and every source collection before opening a write transaction.
2. Capture the original JSON as an immutable raw snapshot; verify byte length and SHA-256.
3. Normalize into staging records using one IndexedDB transaction spanning all relevant stores.
4. Preserve IDs, order, unknown fields, absent-vs-null-vs-empty distinctions, nested invoice items, and exact image data.
5. Verify collection counts, ID uniqueness, relationship resolution, financial control totals above, four blank receipt dates, and all eight image hashes.
6. Close and reopen the database; repeat verification from persisted records.
7. Keep LocalStorage untouched. Do not connect application reads/writes, delete legacy keys, or perform cutover as part of this stage.
8. Keep backup, restore, and factory-reset paths outside this prototype until separately tested.

## 7. Current prototype limitation

The current schema adapter is a round-trip prototype that stores the accounting payload as one JSON value in the existing `kv` store. Its successful synthetic test proves JSON preservation and basic IndexedDB operations only. It does **not** yet normalize the complete v6 backup, write the domain stores above, or prove real-backup migration.

Audit conclusion: the backup is structurally readable and its inspected references/control totals are internally consistent. The next implementation should be a separate full-backup staging adapter, still synthetic/anonymized for browser testing, before any real data import or application cutover.
