/**
 * shared/util.js — pure, dependency-free helpers used across pages and the SW.
 * Universal IIFE attaching to BID.util.
 */
(function () {
  'use strict';
  const g = (typeof self !== 'undefined') ? self : this;
  g.BID = g.BID || {};

  /** Human-readable byte size. */
  function formatBytes(bytes) {
    if (bytes == null || !isFinite(bytes) || bytes < 0) return '—';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const val = bytes / Math.pow(1024, i);
    const num = (val >= 100 || i === 0) ? String(Math.round(val)) : val.toFixed(1).replace(/\.0$/, '');
    return `${num} ${units[i]}`;
  }

  /**
   * Rough byte estimate from pixel dimensions when the file isn't fetched yet.
   * Per-format bytes-per-pixel heuristics (compressed). Returns null if unknown.
   * Deliberately conservative; the UI must mark it approximate ("~").
   */
  const BPP = { jpg: 0.25, jpeg: 0.25, webp: 0.18, avif: 0.12, png: 1.0, gif: 0.5, bmp: 4, svg: null, ico: 1, tiff: 3, tif: 3 };
  function estimateBytes(width, height, ext) {
    if (!width || !height) return null;
    const bpp = (ext && ext in BPP) ? BPP[ext] : 0.3;
    if (bpp == null) return null; // e.g. svg — size unrelated to dimensions
    return Math.round(width * height * bpp);
  }

  /** Parse a URL into useful pieces. Tolerant of data: and blob: URIs. */
  function parseImageUrl(url, pageUrl) {
    const out = { absolute: url, domain: '', filename: '', ext: '', scheme: '' };
    try {
      const u = new URL(url, pageUrl || undefined);
      out.absolute = u.href;
      out.scheme = u.protocol.replace(':', '');
      if (u.protocol === 'data:') {
        out.domain = 'data:';
        const m = /^data:([^;,]+)/.exec(url);
        out.ext = m ? mimeToExt(m[1]) : '';
        out.filename = '';
        return out;
      }
      if (u.protocol === 'blob:') { out.domain = 'blob:'; return out; }
      out.domain = u.hostname;
      const pathname = decodeURIComponent(u.pathname);
      const base = pathname.split('/').pop() || '';
      out.filename = base;
      const dot = base.lastIndexOf('.');
      if (dot > 0 && dot < base.length - 1) {
        out.ext = base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
      }
    } catch (_) { /* leave defaults */ }
    return out;
  }

  function mimeToExt(mime) {
    const map = {
      'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
      'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp',
      'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
      'image/tiff': 'tiff',
    };
    return map[(mime || '').toLowerCase()] || '';
  }

  /** Trailing-edge debounce. */
  function debounce(fn, ms) {
    let t = null;
    const wrapped = function (...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(this, args); }, ms);
    };
    wrapped.cancel = () => { if (t) { clearTimeout(t); t = null; } };
    return wrapped;
  }

  /** requestAnimationFrame-throttled wrapper (leading + latest args). */
  function rafThrottle(fn) {
    let scheduled = false;
    let lastArgs = null;
    const raf = (typeof requestAnimationFrame !== 'undefined')
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16);
    return function (...args) {
      lastArgs = args;
      if (scheduled) return;
      scheduled = true;
      raf(() => { scheduled = false; fn.apply(this, lastArgs); });
    };
  }

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  /** Escape for safe insertion as text/attribute inside HTML strings. */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Stable de-dupe by a key function, preserving first occurrence. */
  function uniqueBy(arr, keyFn) {
    const seen = new Set();
    const out = [];
    for (const item of arr) {
      const k = keyFn(item);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  }

  /** Hamming distance between two hex strings of equal length (for M2 dedupe). */
  function hammingHex(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
      let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
      while (x) { dist += x & 1; x >>= 1; }
    }
    return dist;
  }

  /** Small non-crypto id; fine for within-session scan ids. */
  function shortId() {
    // Avoid Math.random dependency concerns by mixing time + counter.
    shortId._c = (shortId._c || 0) + 1;
    const t = (typeof performance !== 'undefined' && performance.now)
      ? Math.floor(performance.now() * 1000) : 0;
    return (t.toString(36) + shortId._c.toString(36) + Date.now().toString(36)).slice(-12);
  }

  g.BID.util = {
    formatBytes, estimateBytes, parseImageUrl, mimeToExt,
    debounce, rafThrottle, clamp, escapeHtml, uniqueBy, hammingHex, shortId,
  };
})();
