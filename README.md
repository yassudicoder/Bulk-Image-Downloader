# Bulk Image Downloader by TheOpenBox

A privacy-first Chrome (MV3) extension for professional repeat-downloaders — POD sellers,
resellers, listing managers. Scan a page's images, filter, **deduplicate with perceptual
hashes**, route into Download subfolders by rule, and download individually or as a zip.
Everything runs client-side. No backend, no accounts, no AI.

Two headline promises:

1. **Dedupe that works** — exact (SHA-256) + perceptual (dHash) duplicate detection.
2. **Sees nothing until you click** — zero install-time host permissions. The extension has
   no access to any site until you click the toolbar icon on the tab you want scanned.

> This is the open MVP repo. The build proceeds one milestone per PR (see the brief). This
> commit is **Milestone 1**: scaffold, scanner, results grid, filters, and individual
> downloads.

## Architecture at a glance

| Piece | Where | Notes |
|-------|-------|-------|
| Toolbar click | `background/service-worker.js` | Injects the scanner via `chrome.scripting` using `activeTab` (temporary, per-click access) |
| Scanner | `content/scanner.js` | Injected on demand — never a declared content script |
| Results grid | `results/` | Virtualized grid, filters, selection, downloads. Opened as an extension tab |
| Shared core | `shared/` | Design tokens, i18n, entitlements, analytics, utilities |
| Locales | `_locales/` | `en` complete; other locales scaffolded |

## Permissions (non-negotiable)

```
permissions:               activeTab, scripting, downloads, storage
optional_host_permissions: <all_urls>   (requested at runtime, on user gesture, only for the
                                          CORS exact-dedupe fallback — not used in M1)
host_permissions:          NONE at install time. Ever.
```

## Install (unpacked, for development)

1. Run `node tools/gen-icons.js` once to generate placeholder icons (already committed).
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select this repository's root folder.
4. Click the toolbar icon on any page to scan it.

## No build step

Vanilla JS, IIFE namespacing under `BID.*`, token-based CSS custom properties, no frameworks,
no bundler. Vendored libraries only (JSZip lands in M3); **no CDN requests, ever** (MV3
remote-code ban). `tools/build.js` (M5) only assembles the shippable zip — it is not required
to run the extension.

## Privacy & analytics

Analytics (PostHog) are **off by default** and opt-in via a one-time prompt. Events are
content-free — counts and feature names only, never URLs or image data. See the options page.

## Milestones

- **M1** (this PR) — scaffold, scanner, results grid, filters, individual downloads.
- **M2** — dedupe engine (exact + perceptual), CORS ladder, cross-session index.
- **M3** — folder rules + bulk zip.
- **M4** — i18n pass, options/welcome polish, opt-in analytics, store listing.
- **M5** — hardening across the test matrix, `0.9.0` beta build.
