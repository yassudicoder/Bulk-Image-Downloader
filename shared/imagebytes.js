/**
 * shared/imagebytes.js — fetch raw image bytes with bounded concurrency. BID.imageBytes.
 *
 * Fetching an image's bytes from an extension page is subject to CORS: same-origin,
 * data:, and CORS-friendly cross-origin images succeed with no special permission;
 * CORS-hostile CDNs throw until the extension holds a host permission for that origin.
 * This module only fetches and classifies — the caller runs the "hybrid" flow: try once,
 * and if anything errored while we lack <all_urls>, offer to request it and retry.
 *
 * requestAllUrls() calls chrome.permissions.request, which MUST run inside a user
 * gesture; call it directly from a click handler, never after an await.
 *
 * Reused by the M2 dedupe engine (which needs the same bytes to hash).
 */
(function () {
  'use strict';
  const g = (typeof self !== 'undefined') ? self : this;
  g.BID = g.BID || {};

  const ALL_URLS = { origins: ['<all_urls>'] };

  function hasAllUrls() {
    return new Promise((resolve) => {
      try {
        chrome.permissions.contains(ALL_URLS, (has) => resolve(!!has && !chrome.runtime.lastError));
      } catch (_) { resolve(false); }
    });
  }

  /** MUST be called synchronously from a user gesture (e.g. a button click handler). */
  function requestAllUrls() {
    return new Promise((resolve) => {
      try {
        chrome.permissions.request(ALL_URLS, (granted) => resolve(!!granted && !chrome.runtime.lastError));
      } catch (_) { resolve(false); }
    });
  }

  /** Fetch one URL -> { bytes:Uint8Array, contentType:string }. Throws on any failure. */
  async function fetchOne(url, signal) {
    // credentials omitted (don't leak cookies); force-cache reuses the just-loaded image.
    // `signal` lets a caller (e.g. ZIP Cancel) abort the transfer in flight, not just between items.
    const resp = await fetch(url, { credentials: 'omit', cache: 'force-cache', redirect: 'follow', signal });
    if (!resp || !resp.ok) throw new Error('http_' + (resp ? resp.status : 'null'));
    const buf = await resp.arrayBuffer();
    return { bytes: new Uint8Array(buf), contentType: resp.headers.get('content-type') || '' };
  }

  /**
   * Fetch bytes for many candidates with bounded concurrency.
   * @param {Array} items candidates (each must have `.url`)
   * @param {{concurrency?:number, onProgress?:(done:number,total:number)=>void, signal?:AbortSignal}} [opts]
   * @returns {Promise<{ok:Array<{item,bytes,contentType}>, errored:Array<{item,error}>}>}
   */
  async function fetchAll(items, opts) {
    const options = opts || {};
    const concurrency = Math.max(1, options.concurrency || 6);
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const signal = options.signal || null;

    const total = items.length;
    const ok = [];
    const errored = [];
    let done = 0, cursor = 0, bytesSoFar = 0;

    async function worker() {
      while (cursor < items.length) {
        if (signal && signal.aborted) return;
        const item = items[cursor++];
        try {
          const { bytes, contentType } = await fetchOne(item.url, signal);
          ok.push({ item, bytes, contentType });
          bytesSoFar += bytes.length;
        } catch (e) {
          errored.push({ item, error: (e && e.message) ? e.message : 'fetch_failed' });
        }
        done++;
        // Third arg (bytes fetched so far) powers the ZIP panel; older callers ignore it.
        if (onProgress) onProgress(done, total, bytesSoFar);
      }
    }

    const pool = [];
    for (let i = 0; i < Math.min(concurrency, items.length); i++) pool.push(worker());
    await Promise.all(pool);
    return { ok, errored };
  }

  g.BID.imageBytes = { hasAllUrls, requestAllUrls, fetchOne, fetchAll };
})();
