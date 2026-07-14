# Scanner Test Fixtures

Static, fully-offline HTML fixtures that exercise the Bulk Image Downloader
extension's image **scanner** (candidate discovery). Every fixture is
self-contained: real images are inline **SVG `data:` URIs** with explicit
intrinsic `width`/`height`, so the browser reports genuine
`naturalWidth`/`naturalHeight` with **no network access**. Open any file
directly via `file://`.

## Scanner source types

| sourceType   | Discovered from |
|--------------|-----------------|
| `img`        | `<img>` `currentSrc` |
| `srcset`     | parsed `srcset` width descriptors |
| `picture`    | `<picture>` `<source>` sets |
| `background` | CSS `background-image: url(...)` (computed style) |
| `lazy`       | `data-src` / `data-original` / `data-lazy-src` |
| `shadow`     | images inside **open** shadow roots |

## Fixtures

| File | Tests | Expected candidates (by type) |
|------|-------|-------------------------------|
| `stress-1500.html` | Performance/stress: 1,500 generated images, varied sizes & colors; grid smoothness; scan < 2s | **~1500** — 1474 `img` + 20 `lazy` + 6 `shadow` |
| `zero-images.html` | Empty-state path; article with no images at all | **0** |
| `srcset-webp-avif.html` | Responsive `srcset` width-descriptor picking; `<picture>` avif/webp/fallback; `.webp`/`.avif` extension parsing | **9** — 3 `srcset` + 3 `picture` + 3 `img` (extension; 404 offline) |
| `lazy-scroll-blog.html` | Lazy-attr discovery before load + full-page scroll nudge on a tall (~8400px) page; IntersectionObserver swaps `data-*`→`src` | **30** — all `lazy` |
| `background-image.html` | CSS `background-image` via inline style + class; multiple backgrounds; gradient must be ignored | **15** `background` (gradient-only element = 0) |
| `shadow-dom.html` | Open shadow-root traversal incl. nested root; closed root missed by design | **5** `shadow` found (+1 in a **closed** root expected MISSED) |
| `cors-note.html` | Cross-origin CDN URL/host parsing + M2 CORS-degrade path vs. local data URIs | **4** `img` — 2 remote (404 offline) + 2 local data URIs |

## Notes per fixture

- **stress-1500.html** — All 1,500 `<img>` are built in a JS loop (the file
  stays tiny). Sizes cycle through 40x40 icons up to 1200x800 heroes; colors
  cycle a 16-swatch palette; ~1/3 carry descriptive `alt`; the URI label varies
  a fake filename. 20 images use `data-src` only (lazy) and 6 live in an open
  shadow root so the set is not homogeneous. On-screen size is CSS-clamped and
  does **not** change intrinsic dimensions. Generation time is logged to the
  console and shown on-page.
- **srcset-webp-avif.html** — `srcset` uses space-free, comma-safe data URIs so
  the parser reads the width descriptors; the 1440w (1440x960) URI is the
  "prefer largest" target. AVIF is simulated with a distinct SVG + correct
  `type="image/avif"`. The 3 extension-test `<img>` use relative `.webp`/`.avif`
  paths (broken offline) purely for URL/extension handling.
- **lazy-scroll-blog.html** — 10 images each via `data-src`, `data-original`,
  `data-lazy-src`. Before scrolling, all 30 are discoverable via lazy attrs;
  scrolling loads real `src` so a second pass reads real dimensions.
- **background-image.html** — 10 inline-style + 2 class = single url(); 1 element
  with two url()s (counts 2); 1 gradient-only (counts 0); 1 gradient+url()
  (counts 1). Total 15 real background images.
- **shadow-dom.html** — Host A (open) has 3 images and contains nested Host B
  (open) with 2 more = 5 found. Host C (closed) has 1 image that the scanner
  cannot reach — expected MISSED.
- **cors-note.html** — Minimal: 2 broken cross-origin CDN images (URL/domain
  parsing, CORS-degrade in M2) + 2 local data URIs that always render.

## Cross-reference: extension test matrix

| Test-matrix scenario | Covered by fixture(s) |
|----------------------|-----------------------|
| Etsy (CSS thumbnail grids) | `background-image.html` |
| Amazon (mixed `<img>` + CSS backgrounds) | `background-image.html`, `stress-1500.html` |
| Infinite-scroll blog | `lazy-scroll-blog.html` |
| Unsplash (responsive srcset) | `srcset-webp-avif.html` |
| WordPress (lazy-loaded posts) | `lazy-scroll-blog.html` |
| WebP + AVIF srcset | `srcset-webp-avif.html` |
| CORS-hostile CDN | `cors-note.html` |
| 1500-stress | `stress-1500.html` |
| Zero-image | `zero-images.html` |
| Web-component / Shadow DOM sites | `shadow-dom.html` |
