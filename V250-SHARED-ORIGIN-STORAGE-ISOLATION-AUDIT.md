# v250 — Shared-Origin Storage Isolation Audit

Date: 2026-11-07  
Repository: `Thehandymanjob/accountancy-test`  
Branch: `release239`  
Scope: static source and URL-origin analysis only

## Finding

The GitHub Pages URLs

- `https://thehandymanjob.github.io/accountancy/`
- `https://thehandymanjob.github.io/accountancy-test/`

have the same web origin: `https://thehandymanjob.github.io`.

Browser storage is scoped to the origin, not to the URL path. Consequently:

- Both paths share the same LocalStorage area.
- Both paths share IndexedDB databases opened under the same database name.
- A database named `the_handyman_accountancy_v250_idb` is not isolated merely because the page was loaded from `/accountancy-test/`.
- A test page can observe or modify origin-wide storage also used by the production path if it uses the same keys/database names.

This means the test path is not a separate browser-storage sandbox. The assumption that `accountancy-test` has isolated LocalStorage or IndexedDB is incorrect.

## Verified v250 repository details

- The v250 repository module opens IndexedDB database `the_handyman_accountancy_v250_idb`.
- The repository module does not itself read or write LocalStorage.
- The legacy staging module explicitly reads LocalStorage key names and values and stages exact raw strings in the repository's `legacy` domain.
- The application `index.html` v250 baseline is still not loading the v250 repository module; no app cutover has occurred.
- No production `index.html` or `main` branch changes were made as part of this audit.

## Inventory discrepancy — unresolved

A user-provided diagnostic previously reported 40 LocalStorage keys and 40 legacy records, with exact key-name agreement. A later user-provided diagnostic reported 29 LocalStorage keys and 29 legacy records, again with exact key-name agreement.

The later result proves only that the then-current LocalStorage key names matched the then-current staged legacy record names. It does not prove what happened to the earlier inventory. The reports contain different key names; the difference must not be described simply as eleven deletions without a full exact comparison of both captured inventories.

The user reports that no Restore or Factory Reset was run between the two observations. Therefore those actions are not an established explanation. Shared-origin access is a confirmed architectural risk and a plausible contributor, but it is not proof of the precise event that changed the inventory.

## Safety decision

- Do not run the guarded backup import yet.
- Do not weaken the import guard from 40 to 29 merely to make Prepare pass.
- Do not delete, merge, rename, deduplicate, or repair any LocalStorage or IndexedDB records.
- Keep the authoritative backup `New_new(1).json` unchanged.
- Preserve the current 29 staged legacy records exactly as they are.
- Preserve the earlier downloaded legacy snapshot; it may be needed to recover the earlier 40-record inventory.
- Keep `index.html` and the production repository/branch untouched.

## Required design correction before future browser testing

A GitHub Pages path is not a storage-isolation boundary. Future testing that needs isolated browser storage must use a genuinely different origin (for example, a separate host/subdomain), or use an explicitly designed and reviewed storage namespace/database strategy. Merely changing the path or cache-busting query string is insufficient.

Any future isolation change must be designed so that it cannot silently read, overwrite, or migrate the production user's LocalStorage or IndexedDB. Do not implement an origin/storage migration as part of this audit.

## Current status

Investigation only. No business data was read by this static audit, no browser storage was changed by this audit, no backup was imported, and no application cutover was performed.
