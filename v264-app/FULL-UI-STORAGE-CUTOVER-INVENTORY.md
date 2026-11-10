# v264 full UI storage cutover inventory

Date: 2026-11-10
Source: `v264-app/index.html` copied from test-repository v262 root.
Status: inventory only; no UI or CSS changes made.

## Result

The current full UI is still a LocalStorage application. A source scan found 73 lines matching storage access or core storage entry points. This count is a line-match count, not a count of individual API calls. The full UI must not be enabled with the v264 IndexedDB modules until every listed domain has an asynchronous persistence path and the browser test confirms zero legacy storage access.

## Storage domains and consumers

| UI area | Current source evidence | Required v264 owner |
|---|---|---|
| Accounting entries, customers, invoices, categories, settings | `KEY`, `loadDB`, `persist`, save/delete handlers, invoice sequence | Accounting controller + invoice workflow + sequences |
| Project workspace, project financials, people, partners, contractors, completion | `PR_KEY`, `prLoad`, `prPersist`, project sync and completion handlers | Projects controller; accounting transfer must remain separately approved |
| Contracts | `CT_KEY`, `ctRead`, `ctWrite`, contract CRUD | Contracts controller |
| Business profile and logo | Project workspace `profile`, report logo, launcher logo, contract profile | Business profile controller; media must be persisted and backed up |
| Language preference | `APP_LANG_KEY`, `APP_LANG_PREF_VERSION_KEY`, report archive language | Preferences domain |
| Monitor and diagnostics | `MONITOR_LOG_KEY`, monitor context and self-check | Diagnostics domain; do not keep app data in browser Storage |
| Help contact drafts | Help contact submission and prior domain audit | Add a dedicated support/help-draft domain; current support controller does not cover this key |
| Receipt, project, contract and payment documents | File inputs, data URLs, Blob/File values, report and print rendering | Media domain or typed media records; backup/restore must include binary bytes and metadata |
| Backup and restore | Current comprehensive backup reads LocalStorage and IndexedDB inventories | Replace with a single IndexedDB snapshot/export and verified restore; no legacy storage inventory dependency |
| Factory reset / recovery | Reset confirmation, reset locks and recovery workflow | Recovery controller; must be fail-closed and preserve a verified backup |

## Critical synchronous call sites

- Accounting startup: `loadDB()`, cleanup helpers, invoice sequence repair, and direct startup writes.
- Accounting writes: `persist()` is called from entries, customers, invoices, settings, categories, and invoice payment state.
- Projects startup: `prLoad()` is called when opening Projects and at script initialization.
- Projects writes: `prPersist()`, project completion, project financial sync and removal.
- Contracts: synchronous `ctRead()` / `ctWrite()` are used by save, load, delete, list and print.
- Reports and launcher read profile logo synchronously.
- Monitor and language preference code reads/writes browser Storage directly.
- Backup/restore currently expects both LocalStorage and IndexedDB data and therefore cannot be reused unchanged for the IndexedDB-only architecture.

## Cutover rules

1. Keep the copied v262 HTML, CSS, component structure, print CSS, report markup and button layout unchanged. Replace data access behind handlers, not visual markup.
2. Startup must await required domain initialization and loads before enabling any write-capable UI.
3. Keep `db` and `prDB` only as in-memory render models, populated from IndexedDB. They must never be authoritative or synchronously persisted.
4. Every mutating handler must await a controller transaction, verify success, then refresh its in-memory view. On failure, retain/restore the previous view and show an error.
5. No LocalStorage/SessionStorage/cookie access, no synchronous compatibility shim, no shadow write, no silent fallback and no legacy import.
6. Preserve existing project/accounting separation: project-to-accounting transfer only after explicit approval; transfer must not alter project P&L.
7. Backup/restore must cover every domain and every binary asset. A Blob round-trip in accounting alone does not prove all media fields are included.
8. Do not change print templates, font sizes, logo sizing, page breaks, margins, report layout or invoice/contract print markup.

## Next implementation order

1. Finish storage-domain inventory and add explicit media/help-draft coverage to the domain registry and backup allowlist.
2. Build an async app state coordinator that loads accounting, projects, contracts, profile, preferences, diagnostics, reports, support drafts and media before UI activation.
3. Migrate accounting handlers as a complete vertical slice, then run browser regression tests.
4. Migrate projects and their linked financial/third-party records; preserve the explicit transfer approval boundary.
5. Migrate contracts, profile/logo and media.
6. Migrate backup/restore, reports, diagnostics and preferences.
7. Run a whole-app scan and runtime trap proving zero legacy Storage API access.
8. Compare v264-app print output against the v262 source for invoice, contract, report and project P&L before enabling the app.

## Current test status

The user-provided v264 accounting/invoice browser result is PASS for the isolated bridge checks. It does not certify the full app UI, projects, contracts, backup/restore, reports, print output or media backup coverage. No full UI cutover is approved.
