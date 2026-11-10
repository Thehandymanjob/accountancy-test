# Accounting and invoice async cutover map

Date: 2026-11-10
Source: `v264-app/index.html` (copied v262 UI)
Status: analysis only; no UI handlers changed.

## State contract

Legacy UI state is a single object:
`{ entries, customers, invoices, customExpenseCategories, settings, ... }`

v264 accounting fallback currently defines:
`{ entries:[], customers:[], invoices:[], customExpenseCategories:[], settings:{businessName:"",ownerName:""} }`

The v264 controller preserves additional unknown top-level fields only if the accounting normalizer permits them; inspect its full normalize/validation rules before moving data or finalizing the shape. Since user intends to start with fresh data, no legacy import is planned.

## Confirmed handler dependencies

| Handler / function | Current behavior | Required v264 replacement |
|---|---|---|
| `loadDB()` | Synchronous LocalStorage read and validation | `await HandymanAccountingV264.load()`; fail closed if unavailable |
| `persist()` | Synchronous LocalStorage write/read-back, then queued IndexedDB shadow write | Remove completely; use awaited controller operations with read-back verification |
| `saveEntry()` | Mutates global `db`, then calls persist and shadow-readback | `await accounting.update/addEntry`; update UI state only after confirmed save |
| `editEntry()` | Reads in-memory `db.entries` and fills form | Can remain synchronous only after authoritative state has loaded; must not write |
| `deleteEntry()` | Mutates global `db`, then persist | `await accounting.deleteEntry(id)`; restore display state on failure |
| `saveCustomer()` | Async handler already; currently likely mutates db/persist | Use `saveCustomer` controller and verify customer ID stability |
| `deleteCustomer()` | Async handler; checks invoice references, then mutates db | Preserve referential-integrity check; controller delete only after check |
| Invoice create/edit | Existing invoice form and customer state are coupled to `db` | `HandymanInvoiceWorkflowV264.saveInvoice(invoice,payment,customer)`; inspect all fields and side effects |
| Mark paid/unpaid | Legacy handler changes invoice and creates/removes linked income entry | `markPaid/markUnpaid`; verify linked entry ID, dates, amount and duplicate prevention |
| Invoice soft delete | Legacy invoice deletion/status logic | `softDelete(id)`; verify old behavior and record retention |
| Invoice numbering | LocalStorage counter + highest shared invoice/income number helpers | `reserveInvoiceNumber(minimum)`; reconcile existing numbers only for newly created blank DB |
| Settings business name/owner | Stored in accounting `settings` and also referenced by report/PDF | Keep existing UI settings behavior and field names; ensure profile domain ownership is unambiguous |
| Expense category additions | `customExpenseCategories` in accounting state | Persist through accounting controller |
| Contractor picker | Reads contractors from project LocalStorage | Load from Projects controller; no cross-domain synchronous read |

## Async UI constraints

- The main `db` object may remain an in-memory view-model/cache for rendering, but it cannot be the durable source of truth.
- Initial startup must await all required domain loads before enabling actions or showing a writable screen.
- Every mutating event path must await persistence. A failed write must leave the displayed state unchanged or restore the previous state and show a visible error.
- Do not make a synchronous LocalStorage compatibility shim for IndexedDB.
- Do not retain shadow writes, legacy import, or silent fallback.
- Any renderer that reads global `db` can remain synchronous if the view-model is refreshed only from verified IndexedDB controller results.
- Avoid concurrent stale saves: use controller atomic `update(mutator)` for single-domain changes rather than read/modify/write from an old UI snapshot.

## Important feature mismatch requiring decision before implementation

The v264 UI adapter currently rejects partial invoice payments unless the payment amount equals the full invoice total. This is not proven to match v262 behavior. The workflow controller must be inspected and extended if v262 supports deposits, staged payments, or multiple partial payments. Do not cut over invoices until this is resolved.

## Next coding sequence

1. Inspect full accounting controller and invoice workflow validation and data mutations.
2. Map all invoice/customer handlers and all sequence helpers (including delete/re-number edge cases).
3. Implement async state initialization and accounting entry CRUD only, with an isolated browser test page.
4. Then migrate customer and invoice handlers, including partial payments if supported by the v262 UI.
5. Run new browser tests for persistence after reload and zero LocalStorage access before proceeding to projects.
