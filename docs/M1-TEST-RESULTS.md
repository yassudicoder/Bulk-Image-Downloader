# M1 Test Results

Verification of Milestone 1 (scaffold, scanner, results grid, filters, individual downloads).
Automated runs used a real Chromium (via Playwright) driving the actual `content/scanner.js`
and `results/*` modules over a local static server, plus Node unit tests for the pure logic.

**M1 "Done" bar:** *500-image blog scans in <2s, grid smooth, downloads land.* → **met with
large margin** (1,500 images scanned in ~21 ms; grid renders ≤40 DOM cells for 1,000 items).

## 1. Scanner vs. local fixtures (real scanner.js, headless Chromium)

Each fixture was loaded in a browser and scanned with the shipped `__bidRunScan()`. Counts are
the scanner's actual output, broken down by `sourceType`.

| Fixture | Expected | Scanner output | Scan time | ✓ |
|---|---|---|---|---|
| `stress-1500.html` | 1500 (1474 img / 20 lazy / 6 shadow) | **1500** (1474 / 20 / 6) | **21 ms** | ✅ |
| `zero-images.html` | 0 (clean empty state) | **0** | 0 ms | ✅ |
| `srcset-webp-avif.html` | 9 (3 srcset / 3 picture / 3 img) | **9** (3 / 3 / 3); `.webp`/`.avif` ext parsed | 1 ms | ✅ |
| `lazy-scroll-blog.html` (quick) | 30 (mostly lazy) | **30** (2 img already-loaded / 28 lazy) | 1 ms | ✅ |
| `lazy-scroll-blog.html` (full-page) | reveal all lazy | **30** (all reclassified to img after nudge) | 2.4 s* | ✅ |
| `background-image.html` | 15 background (gradients ignored) | **15** background | 1 ms | ✅ |
| `shadow-dom.html` | 5 open-root (1 closed missed) | **5** shadow; closed root correctly unreachable | 1 ms | ✅ |
| `cors-note.html` | 4 (2 remote / 2 local) | **4** img; remote name+ext parsed while offline | 1 ms | ✅ |

*The 2.4 s for the full-page scan is the **intentional** scroll-nudge budget (a deliberate,
user-initiated action that scrolls the page to trigger lazy loaders); the quick scan is 1 ms.

Validated scanner behaviors: `<img>`/`currentSrc`, srcset + `<picture>` **largest-descriptor**
selection, CSS `background-image` (gradients excluded), lazy attributes, **open** shadow-root
recursion (closed roots skipped), extension detection from URL path and data-URI MIME, URL-level
dedupe, `MAX_CANDIDATES` guardrail, and scroll-position restoration after the nudge.

## 2. Virtualized grid (real grid.js, 1,000 items)

| Check | Result |
|---|---|
| Total items / columns | 1000 / 5 |
| Virtual scroll height | 42,188 px |
| DOM cells at top / middle / bottom | 25 / 40 / 25 (**windowed — never ~1000**) |
| Window follows scroll | ✅ middle window starts after top; bottom reaches item #999 |
| Click-to-select | ✅ selection set updates, `is-selected` applied |

## 3. Full results pipeline (real results.html + all modules, stubbed chrome APIs)

Seeded a 6-image scan (mixed sources, types, domains; 4 remote + 2 data-URI) and drove the UI:

| Behavior | Result |
|---|---|
| Header count (i18n plural + placeholder) | "6 images", "from shop.example.com" ✅ |
| Facets built | types = [jpg, png, svg, webp]; domains = [cdn.shop.example, img.other.example] (`data:` excluded) ✅ |
| Broken offline thumbnails | 4 cells flagged `is-broken` via `onerror` ✅ |
| Select-all filtered → footer | "6 selected", size "~304 KB est." ✅ |
| Download selected | 6 `chrome.downloads.download` calls; filenames `hero.jpg`, `icon.png`, … (sanitized) ✅ |
| Filter: min width 500 | "4 of 6 shown" ✅ |
| Filter: type = jpg | "2 of 6 shown" ✅ |
| Clear selection | footer resets to "Select images to download" ✅ |
| One-time analytics prompt | shown (not previously asked) ✅ |
| Load without a scan / no `chrome` | degrades to error state, no uncaught errors ✅ |

## 4. Node unit tests (pure logic)

`shared/util`, `results/filters`, `results/downloads` — **33/33 passing**. Covers `formatBytes`,
`estimateBytes` (svg → dimension-independent), `parseImageUrl` (http/data/relative), `hammingHex`,
filter facets + predicate (min-size with unknown-passes, type, domain, name-in-alt, combined), and
filename sanitization (path-traversal `../../etc/passwd` → `passwd.jpg`, reserved `CON` → `_CON`,
illegal chars, leading dots, fallback extension).

## 5. Static wiring checks

All `data-i18n*` keys, all `getElementById`/`$()` DOM ids, and all manifest `__MSG_*__` tokens
resolve against `_locales/en/messages.json` and their paired HTML — **no dangling references**.

## Pending manual (live-site) matrix — for the reviewer / M5 hardening

The automated runs used local fixtures because live sites aren't reachable from the build
environment. Before the beta, run the toolbar-click flow on the real matrix and record results:
Etsy listing, Amazon product, an infinite-scroll blog, Unsplash search, a plain WordPress post,
a CORS-hostile CDN page (M2 will exercise graceful hash-degrade), and uninstall/reinstall
(confirm nothing unexpected persists). The scanner logic behind each is already fixture-verified
above.
