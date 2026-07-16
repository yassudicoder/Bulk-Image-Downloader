/**
 * shared/theme.js — light/dark/system theme preference. BID.theme.
 *
 * The preference lives in localStorage (a per-device UI setting), NOT in chrome.storage, so:
 *   - it reads synchronously and applies before first paint (no flash of the wrong theme),
 *   - a change in the options page live-updates every open page via the 'storage' event
 *     (all extension pages share the chrome-extension:// origin),
 *   - it can't be clobbered by other settings writers.
 *
 * 'auto' removes the [data-theme] attribute so the tokens.css @media query follows the OS.
 * Load this SYNCHRONOUSLY in <head> (before the body paints) on every user-facing page.
 */
(function () {
  'use strict';
  const g = (typeof self !== 'undefined') ? self : this;
  g.BID = g.BID || {};

  const LS_KEY = 'bid:theme';                 // 'auto' | 'light' | 'dark'
  const VALID = ['auto', 'light', 'dark'];    // array, so inherited keys can't slip through
  const normalize = (v) => (VALID.indexOf(v) !== -1 ? v : 'auto');

  function read() {
    try { return normalize(localStorage.getItem(LS_KEY)); } catch (_) { return 'auto'; }
  }

  /** Reflect a preference on <html> without persisting it. */
  function applyToDom(pref) {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    if (!el) return;
    pref = normalize(pref);
    if (pref === 'light' || pref === 'dark') el.setAttribute('data-theme', pref);
    else el.removeAttribute('data-theme'); // auto -> tokens.css @media governs
  }

  function get() { return read(); }

  /** Persist + apply a preference across the whole extension (this device). */
  function set(pref) {
    pref = normalize(pref);
    try { localStorage.setItem(LS_KEY, pref); } catch (_) {}
    applyToDom(pref);
    return pref;
  }

  function init() {
    applyToDom(read());
    try {
      // 'storage' fires in OTHER extension pages when one changes the preference.
      window.addEventListener('storage', (e) => {
        if (e.key === LS_KEY) applyToDom(read());
      });
    } catch (_) {}
  }

  g.BID.theme = { get, set, apply: applyToDom, normalize, init };

  // Apply as early as possible (this script is loaded synchronously in <head>).
  if (typeof document !== 'undefined') init();
})();
