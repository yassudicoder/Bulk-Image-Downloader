/**
 * shared/analytics.js — opt-in, content-free analytics gate.
 * Universal IIFE attaching to BID.analytics.
 *
 * Contract (must match options copy AND the privacy page, from v0.1):
 *  - OFF by default. Enabled only after an explicit one-time opt-in prompt.
 *  - Content-free: event name + numeric/enum properties ONLY. Never URLs, filenames,
 *    hostnames, image bytes, or page content.
 *  - M1: no network transport exists yet (the vendored PostHog client lands in M4). Until
 *    then capture() is a no-op beyond an optional debug log — nothing leaves the device.
 */
(function () {
  'use strict';
  const g = (typeof self !== 'undefined') ? self : this;
  g.BID = g.BID || {};

  const STORAGE_KEY = 'bid:analyticsOptIn'; // must match constants.STORAGE.analyticsOptIn

  // Event vocabulary. Feature names only — no free-form strings from page data.
  const EVENTS = Object.freeze({
    SCAN_RUN: 'scan_run',
    SCAN_FULL_PAGE: 'scan_full_page',
    FILTER_APPLIED: 'filter_applied',
    DOWNLOAD_INDIVIDUAL: 'download_individual',
    DOWNLOAD_BATCH: 'download_batch',
    OPTIONS_OPENED: 'options_opened',
    ANALYTICS_OPT_IN: 'analytics_opt_in',
    ANALYTICS_OPT_OUT: 'analytics_opt_out',
  });

  // Allow-list of property keys that are provably content-free.
  const ALLOWED_PROP_KEYS = new Set([
    'count', 'selected', 'total', 'durationMs', 'fullPage', 'source', 'filterType',
    'format', 'result', 'batchSize', 'ok', 'failed',
  ]);

  let _optedIn = null; // null = not asked yet

  async function _hydrate() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    try {
      const v = await chrome.storage.local.get(STORAGE_KEY);
      _optedIn = (STORAGE_KEY in v) ? !!v[STORAGE_KEY] : null;
    } catch (_) { _optedIn = null; }
  }

  function isOptedIn() { return _optedIn === true; }
  function wasAsked() { return _optedIn !== null; }

  async function setOptIn(value) {
    _optedIn = !!value;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      try { await chrome.storage.local.set({ [STORAGE_KEY]: _optedIn }); } catch (_) {}
    }
    // The opt-in decision itself is a content-free event.
    capture(_optedIn ? EVENTS.ANALYTICS_OPT_IN : EVENTS.ANALYTICS_OPT_OUT);
  }

  /** Strip any property whose key isn't explicitly allow-listed or whose value isn't primitive-safe. */
  function _sanitize(props) {
    const clean = {};
    if (!props) return clean;
    for (const [k, v] of Object.entries(props)) {
      if (!ALLOWED_PROP_KEYS.has(k)) continue;
      const okType = typeof v === 'number' || typeof v === 'boolean'
        || (typeof v === 'string' && v.length <= 32 && /^[a-z0-9_\-]*$/i.test(v));
      if (okType) clean[k] = v;
    }
    return clean;
  }

  /**
   * Record an event. No-op unless opted in. Even when opted in, M1 has no transport —
   * this only debug-logs. The PostHog client (vendored, no CDN) arrives in M4.
   */
  function capture(event, props) {
    if (_optedIn !== true) return;
    const payload = _sanitize(props);
    // eslint-disable-next-line no-console
    if (typeof console !== 'undefined') console.debug('[BID analytics]', event, payload);
    // M4: BID.analytics._transport?.(event, payload)
  }

  // Kick off hydration where storage exists.
  _hydrate();

  g.BID.analytics = {
    EVENTS, isOptedIn, wasAsked, setOptIn, capture,
    _hydrate, // exposed for pages that must await a known state before prompting
  };
})();
