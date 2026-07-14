/**
 * results/filters.js — filter facets + predicate. BID.filters.
 * Pure logic; no DOM. Operates on hydrated candidates (with .domain, .ext).
 */
(function () {
  'use strict';
  const g = self;
  g.BID = g.BID || {};

  const EMPTY_STATE = Object.freeze({
    minWidth: 0, minHeight: 0, fileType: '', domain: '', nameContains: '', hideDuplicates: false,
  });

  /** Unique, sorted file types and domains present in the candidate set. */
  function computeFacets(candidates) {
    const types = new Set();
    const domains = new Set();
    for (const c of candidates) {
      if (c.ext) types.add(c.ext);
      if (c.domain && c.domain !== 'data:' && c.domain !== 'blob:') domains.add(c.domain);
    }
    return {
      types: Array.from(types).sort(),
      domains: Array.from(domains).sort((a, b) => a.localeCompare(b)),
    };
  }

  function normalizeState(raw) {
    const s = Object.assign({}, EMPTY_STATE, raw || {});
    s.minWidth = Math.max(0, parseInt(s.minWidth, 10) || 0);
    s.minHeight = Math.max(0, parseInt(s.minHeight, 10) || 0);
    s.fileType = String(s.fileType || '');
    s.domain = String(s.domain || '');
    s.nameContains = String(s.nameContains || '').trim().toLowerCase();
    s.hideDuplicates = !!s.hideDuplicates;
    return s;
  }

  function isEmpty(state) {
    const s = normalizeState(state);
    return !s.minWidth && !s.minHeight && !s.fileType && !s.domain && !s.nameContains && !s.hideDuplicates;
  }

  function predicate(state) {
    const s = normalizeState(state);
    return function (c) {
      // Use the best size signal available; unknown (0) never fails a size filter.
      const w = c.naturalWidth || c.displayWidth || 0;
      const h = c.naturalHeight || c.displayHeight || 0;
      if (s.minWidth && w && w < s.minWidth) return false;
      if (s.minHeight && h && h < s.minHeight) return false;
      if (s.fileType && c.ext !== s.fileType) return false;
      if (s.domain && c.domain !== s.domain) return false;
      if (s.nameContains) {
        const hay = ((c.filename || '') + ' ' + (c.alt || '') + ' ' + (c.url || '')).toLowerCase();
        if (hay.indexOf(s.nameContains) === -1) return false;
      }
      // hideDuplicates is a no-op until the M2 dedupe engine ships (checkbox is disabled).
      return true;
    };
  }

  function apply(candidates, state) {
    const pass = predicate(state);
    const out = [];
    for (const c of candidates) if (pass(c)) out.push(c);
    out.sort((a, b) => a.domIndex - b.domIndex);
    return out;
  }

  g.BID.filters = { EMPTY_STATE, computeFacets, normalizeState, isEmpty, predicate, apply };
})();
