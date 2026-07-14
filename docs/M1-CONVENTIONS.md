# M1 Conventions & Contracts

The shared contract every module obeys. Keep this in sync with the code; the milestone
review checks against it.

## Module system (no build step)

- **Global namespace:** everything hangs off a single global `BID` object. No ES modules, no
  bundler. Each file is a universal IIFE:
  ```js
  (function () {
    'use strict';
    const g = (typeof self !== 'undefined') ? self : this;
    g.BID = g.BID || {};
    g.BID.someModule = { /* ... */ };
  })();
  ```
- **Pages** (`results`, `options`, `welcome`): load shared + local scripts with ordered
  classic `<script>` tags. `shared/*` first, then the page's own scripts.
- **Service worker** (`background/service-worker.js`): a **classic** worker (NOT
  `type: module`). Pulls shared code with `importScripts('../shared/constants.js', ...)`.
- **Scanner** (`content/scanner.js`): injected on demand via `chrome.scripting.executeScript`.
  It runs in the page's isolated world and is **fully self-contained** — no `BID` deps,
  because content scripts can neither `importScripts` nor import modules. Its few constants
  are inlined and MUST match `shared/constants.js`.

## Permission model (non-negotiable)

- Install-time `host_permissions`: **NONE.**
- `permissions`: `activeTab`, `scripting`, `downloads`, `storage`.
- `optional_host_permissions`: `<all_urls>` — requested only at runtime, on a user gesture,
  only for the M2 CORS exact-dedupe fallback. Not requested at all in M1.
- The scanner reaches the page only through `activeTab`, granted per-click by the toolbar
  action. No declared `content_scripts`.

## Message protocol (`chrome.runtime` messages)

All messages are `{ type: string, ...fields }`. Types live in `BID.constants.MSG`.

| Type | Direction | Payload | Response |
|------|-----------|---------|----------|
| `BID_SCAN_RESULT` | scanner → SW | `{ payload: ScanResult }` | `{ ok, scanId }` |
| `BID_SCAN_ERROR`  | scanner → SW | `{ message, pageUrl }` | `{ ok }` |
| `BID_OPEN_OPTIONS` | page → SW | — | `{ ok }` |

Scan handoff flow: scanner posts `BID_SCAN_RESULT` → SW writes the payload to
`chrome.storage.session` under `scan:<scanId>` and opens
`results/results.html?scan=<scanId>` in a new tab → the results page reads the payload
straight from `chrome.storage.session` (survives SW sleep; no fragile long-lived port).

## Data schemas

### `ScanResult`
```
{
  pageUrl:   string,
  pageTitle: string,
  scannedAt: number,          // epoch ms (stamped by the scanner)
  fullPage:  boolean,         // true if the "scan full page" lazy nudge ran
  stats:     { rawFound: number, afterUrlDedupe: number, durationMs: number },
  candidates: ImageCandidate[]
}
```

### `ImageCandidate`
```
{
  id:            string,      // `c${index}` — stable within one scan
  url:           string,      // absolute, resolved against the page
  sourceType:    'img' | 'srcset' | 'picture' | 'background' | 'lazy' | 'shadow',
  naturalWidth:  number,      // 0 if unknown / not yet loaded
  naturalHeight: number,      // 0 if unknown
  displayWidth:  number,      // rendered box, best-effort (0 if unknown)
  displayHeight: number,
  alt:           string,      // '' if none
  domIndex:      number,      // DOM discovery order
  filename:      string,      // best-effort, parsed from URL
  ext:           string,      // lowercase, no dot ('jpg','png','webp','avif','gif','svg','')
  pageUrl:       string
}
```
Derived on the results side (not stored): `domain` (from `url`), `estBytes`
(dimension heuristic, `util.estimateBytes`).

## i18n

- Every user-facing string goes through `chrome.i18n` / `BID.i18n` from day one.
- Keys are camelCase, grouped by prefix: `ext*`, `action*`, `common*`, `results*`,
  `filter*`, `download*`, `options*`, `welcome*`.
- `en` is complete and is the source of truth. Other locales mirror the same keys.
- Static HTML uses `data-i18n="key"` (textContent), `data-i18n-attr-<attr>="key"`
  (attribute), `data-i18n-html="key"` (trusted innerHTML for our own strings only).
  `BID.i18n.apply(root)` walks these on `DOMContentLoaded`.

## CSS

- Token-based. All design values are `--bid-*` custom properties in `shared/tokens.css`
  (`:root`), with a `prefers-color-scheme: dark` block. No hard-coded colors/spacing in
  component CSS — reference tokens.
- `shared/base.css` provides resets + shared primitives (`.bid-btn`, `.bid-input`,
  `.bid-checkbox`, etc.).

## Entitlements

- `shared/entitlements.js` → `BID.entitlements`.
- `BETA_ALL_FREE = true`. Flags: `crossSessionDedupe`, `folderRules`, `bulkZipOver50`.
- `BID.entitlements.isEnabled(flag)` returns `true` while `BETA_ALL_FREE`, else consults
  stored pro state. Free tier permanently includes: full scan, filters, on-page dedupe,
  unlimited individual downloads. Dedupe is never fully paywalled.

## Analytics

- `shared/analytics.js` → `BID.analytics`. **Off by default**, opt-in via one-time prompt.
- Content-free only: event name + numeric/enum counts. Never URLs, filenames, or image data.
- M1 ships the opt-in gate and event vocabulary; the PostHog transport is vendored in M4.
  Until then a captured event is a no-op (debug log) unless opted in — and never leaves the
  device regardless.

## Storage keys (`BID.constants.STORAGE`)

- `chrome.storage.session`: `scan:<scanId>` → ScanResult.
- `chrome.storage.local`: `bid:settings` (options), `bid:analyticsOptIn` (bool | null =
  not-yet-asked), `bid:dedupeHistory` (M2), `bid:folderRules` (M3).
