/**
 * content/scanner.js — on-demand image scanner.
 *
 * Injected into the active tab by the service worker via chrome.scripting.executeScript,
 * under the activeTab permission (temporary, granted by the toolbar click). It is NEVER a
 * declared content script and NEVER auto-runs.
 *
 * SELF-CONTAINED by necessity: content scripts can't importScripts or import ES modules,
 * so this file has zero BID.* dependencies. The handful of constants below MUST stay in
 * sync with shared/constants.js (SOURCE_TYPES, LAZY_ATTRS, LIMITS).
 *
 * Contract: defines self.__bidRunScan(opts) -> Promise<ScanResult>. The SW injects this
 * file (to define the fn) and then invokes it with a second executeScript that returns the
 * resolved ScanResult. See docs/M1-CONVENTIONS.md.
 */
(function () {
  'use strict';

  // Guard against double-injection: keep the first definition.
  if (self.__bidRunScan) return;

  // --- Constants (mirror shared/constants.js) --------------------------------
  const SOURCE = {
    IMG: 'img', SRCSET: 'srcset', PICTURE: 'picture',
    BACKGROUND: 'background', LAZY: 'lazy', SHADOW: 'shadow',
  };
  const LAZY_ATTRS = ['data-src', 'data-original', 'data-lazy-src'];
  const MAX_CANDIDATES = 20000;
  const MAX_ELEMENTS = 25000; // background/shadow walk budget

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- URL helpers -----------------------------------------------------------
  const ACCEPT_SCHEMES = /^(https?:|data:|blob:)/i;

  function resolveUrl(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (!s || s === '#' || s.startsWith('javascript:') || s.startsWith('about:')) return '';
    try {
      const abs = new URL(s, location.href).href;
      return ACCEPT_SCHEMES.test(abs) ? abs : '';
    } catch (_) { return ''; }
  }

  const MIME_EXT = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp',
    'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
    'image/tiff': 'tiff',
  };

  function parseNameExt(url) {
    let filename = '', ext = '';
    try {
      if (url.startsWith('data:')) {
        const m = /^data:([^;,]+)/.exec(url);
        ext = m ? (MIME_EXT[m[1].toLowerCase()] || '') : '';
        return { filename: '', ext };
      }
      if (url.startsWith('blob:')) return { filename: '', ext: '' };
      const u = new URL(url);
      const base = decodeURIComponent(u.pathname).split('/').pop() || '';
      filename = base;
      const dot = base.lastIndexOf('.');
      if (dot > 0 && dot < base.length - 1) {
        ext = base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
      }
    } catch (_) { /* ignore */ }
    return { filename, ext };
  }

  // --- srcset parsing (WHATWG-ish; tolerant of comma-free data URIs) ----------
  function parseSrcset(input) {
    const out = [];
    if (!input) return out;
    const n = input.length;
    const isWS = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';
    let pos = 0;
    while (pos < n) {
      while (pos < n && (isWS(input[pos]) || input[pos] === ',')) pos++;
      if (pos >= n) break;
      const start = pos;
      while (pos < n && !isWS(input[pos])) pos++;
      let url = input.slice(start, pos);
      let trailingComma = false;
      while (url.endsWith(',')) { url = url.slice(0, -1); trailingComma = true; }
      let desc = '';
      if (!trailingComma) {
        while (pos < n && isWS(input[pos])) pos++;
        const dstart = pos;
        let depth = 0;
        while (pos < n) {
          const c = input[pos];
          if (c === '(') depth++;
          else if (c === ')') depth--;
          else if (c === ',' && depth <= 0) break;
          pos++;
        }
        desc = input.slice(dstart, pos).trim();
      }
      if (url) {
        let width = 0, density = 0;
        const wm = /(\d+)w/.exec(desc);
        const xm = /([\d.]+)x/.exec(desc);
        if (wm) width = parseInt(wm[1], 10);
        else if (xm) density = parseFloat(xm[1]);
        out.push({ url, width, density });
      }
    }
    return out;
  }

  /**
   * Pick the largest-resolution URL available to an <img>, considering its own srcset and
   * any parent <picture>'s <source> elements. Returns {url, type} or null.
   */
  function pickBest(img) {
    const entries = [];
    let sawPicture = false;

    const pic = img.closest && img.closest('picture');
    if (pic) {
      const sources = pic.querySelectorAll('source[srcset], source[data-srcset]');
      for (const s of sources) {
        const ss = s.getAttribute('srcset') || s.getAttribute('data-srcset') || '';
        for (const e of parseSrcset(ss)) { entries.push(e); sawPicture = true; }
      }
    }
    const imgSrcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    const imgEntries = parseSrcset(imgSrcset);
    for (const e of imgEntries) entries.push(e);

    if (!entries.length) return null;

    // Prefer largest width descriptor; then largest density; then keep order.
    let best = null;
    for (const e of entries) {
      if (!best) { best = e; continue; }
      const bw = best.width || 0, ew = e.width || 0;
      if (ew !== bw) { if (ew > bw) best = e; continue; }
      const bx = best.density || 0, ex = e.density || 0;
      if (ex > bx) best = e;
    }
    const url = resolveUrl(best.url);
    if (!url) return null;
    // If the winner came only from the img's own srcset (no picture entries), call it srcset.
    const fromPicture = sawPicture && !imgEntries.includes(best);
    return { url, type: fromPicture ? SOURCE.PICTURE : SOURCE.SRCSET };
  }

  function firstLazyUrl(el) {
    for (const attr of LAZY_ATTRS) {
      if (el.hasAttribute(attr)) {
        const u = resolveUrl(el.getAttribute(attr));
        if (u) return u;
      }
    }
    return '';
  }

  // A currentSrc looks like a placeholder if it's an empty/tiny data URI while a real lazy
  // source is waiting in a data-* attribute.
  function looksPlaceholder(url, img) {
    if (!url) return true;
    if (url.startsWith('data:') && (img.naturalWidth <= 2 || url.length < 256)) return true;
    return false;
  }

  function extractBgUrls(cssValue) {
    // cssValue is a computed backgroundImage; browser has already absolutized url()s.
    const urls = [];
    const re = /url\((['"]?)([^)]*?)\1\)/g;
    let m;
    while ((m = re.exec(cssValue))) {
      const u = resolveUrl(m[2]);
      if (u) urls.push(u);
    }
    return urls;
  }

  // --- Collection ------------------------------------------------------------
  function makeCollector() {
    const seen = new Set();       // absolute URL -> dedupe
    const candidates = [];
    let domCounter = 0;
    let capped = false;

    function rectSize(el) {
      try { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }
      catch (_) { return { w: 0, h: 0 }; }
    }

    function push(url, sourceType, el, meta) {
      if (!url || candidates.length >= MAX_CANDIDATES) { if (candidates.length >= MAX_CANDIDATES) capped = true; return; }
      if (seen.has(url)) return;
      seen.add(url);
      const { filename, ext } = parseNameExt(url);
      const disp = meta && meta.disp ? meta.disp : { w: 0, h: 0 };
      candidates.push({
        id: 'c' + candidates.length,
        url,
        sourceType,
        naturalWidth: (meta && meta.nw) || 0,
        naturalHeight: (meta && meta.nh) || 0,
        displayWidth: disp.w || 0,
        displayHeight: disp.h || 0,
        alt: (meta && meta.alt) || '',
        domIndex: domCounter++,
        filename,
        ext,
        pageUrl: location.href,
      });
    }

    function collectImg(img, inShadow) {
      const alt = img.getAttribute('alt') || '';
      const disp = rectSize(img);
      const nw = img.naturalWidth || 0;
      const nh = img.naturalHeight || 0;

      // 1) Largest srcset/picture descriptor wins (best resolution for downloading).
      const best = pickBest(img);
      const cur = resolveUrl(img.currentSrc || img.getAttribute('src') || '');
      const lazy = firstLazyUrl(img);

      let url = '', type = SOURCE.IMG;
      if (best) { url = best.url; type = best.type; }
      else if (cur && !looksPlaceholder(cur, img)) { url = cur; type = SOURCE.IMG; }
      else if (lazy) { url = lazy; type = SOURCE.LAZY; }
      else if (cur) { url = cur; type = SOURCE.IMG; }

      if (inShadow && url) type = SOURCE.SHADOW;
      push(url, type, img, { nw, nh, disp, alt });

      // Also surface a distinct lazy URL if it differs from the chosen one (real image often
      // lives in data-src while src is a spacer). Dedupe drops it if identical.
      if (lazy && lazy !== url) {
        push(lazy, inShadow ? SOURCE.SHADOW : SOURCE.LAZY, img, { nw: 0, nh: 0, disp, alt });
      }
    }

    function collectRoot(root, inShadow, budget) {
      // Pass A: <img> — cheap, unbudgeted, guaranteed.
      const imgs = root.querySelectorAll('img');
      for (const img of imgs) collectImg(img, inShadow);

      // Pass B: everything else (lazy on non-img, background-image, open shadow roots).
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (budget.count++ > MAX_ELEMENTS) { budget.capped = true; break; }
        const tag = el.tagName;

        // lazy attributes on non-img elements
        if (tag !== 'IMG' && tag !== 'SOURCE') {
          const lu = firstLazyUrl(el);
          if (lu) push(lu, inShadow ? SOURCE.SHADOW : SOURCE.LAZY, el, { disp: rectSize(el) });
        }

        // CSS background-image
        let cs = null;
        try { cs = getComputedStyle(el); } catch (_) { cs = null; }
        if (cs) {
          const bi = cs.backgroundImage;
          if (bi && bi !== 'none' && bi.indexOf('url(') !== -1) {
            const disp = rectSize(el);
            for (const u of extractBgUrls(bi)) {
              push(u, inShadow ? SOURCE.SHADOW : SOURCE.BACKGROUND, el, { disp });
            }
          }
        }

        // Descend into OPEN shadow roots (closed roots expose null and are skipped).
        if (el.shadowRoot) collectRoot(el.shadowRoot, true, budget);
      }
    }

    return {
      run() {
        const budget = { count: 0, capped: false };
        collectRoot(document, false, budget);
        if (budget.capped) capped = true;
        return { candidates, capped };
      },
    };
  }

  // --- Full-page lazy nudge (only when the user explicitly asked) -------------
  async function autoScrollNudge() {
    const startX = window.scrollX, startY = window.scrollY;
    const vh = window.innerHeight || 800;
    const started = performance.now();
    let y = 0, steps = 0;
    const maxSteps = 40, budgetMs = 6000, stepDelay = 90;
    while (
      y < document.documentElement.scrollHeight &&
      steps < maxSteps &&
      (performance.now() - started) < budgetMs
    ) {
      window.scrollTo(0, y);
      await sleep(stepDelay);
      y += Math.max(vh * 0.9, 400);
      steps++;
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(350);
    window.scrollTo(startX, startY);
    await sleep(50);
  }

  // --- Public entry ----------------------------------------------------------
  self.__bidRunScan = async function (opts) {
    const options = opts || {};
    const t0 = performance.now();
    try {
      if (options.fullPage) {
        try { await autoScrollNudge(); } catch (_) { /* non-fatal */ }
      }
      const collector = makeCollector();
      const { candidates, capped } = collector.run();
      const durationMs = Math.round(performance.now() - t0);

      return {
        ok: true,
        pageUrl: location.href,
        pageTitle: document.title || location.href,
        scannedAt: Date.now(),
        fullPage: !!options.fullPage,
        stats: {
          rawFound: candidates.length, // post-URL-dedupe count (dedupe is inline)
          afterUrlDedupe: candidates.length,
          durationMs,
          capped: !!capped,
        },
        candidates,
      };
    } catch (err) {
      return {
        ok: false,
        error: 'scan_failed',
        message: (err && err.message) ? String(err.message).slice(0, 300) : 'unknown',
        pageUrl: location.href,
        scannedAt: Date.now(),
        candidates: [],
      };
    }
  };
})();
