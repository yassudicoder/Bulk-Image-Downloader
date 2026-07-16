/**
 * shared/folderrules.js — folder-routing rule engine. BID.folderRules.
 *
 * Pure logic (no DOM, no chrome). Given an image's metadata and an ordered list of rules,
 * returns a sanitized subfolder path (relative to Downloads) or '' for the Downloads root.
 * The results page applies this to each download's filename directly — Chrome creates the
 * subfolders — so no global onDeterminingFilename hook is needed and other extensions'
 * downloads are never touched. Chrome only permits subfolders inside Downloads (no '..',
 * no absolute paths); expand() enforces that by sanitizing every path segment.
 *
 * A rule: { id, name, enabled, conditions: [{type, value}], template }.
 * Conditions are ANDed; a rule with no conditions is a catch-all (put it last).
 */
(function () {
  'use strict';
  const g = (typeof self !== 'undefined') ? self : this;
  g.BID = g.BID || {};

  const TOKENS = ['{domain}', '{yyyy}', '{mm}', '{dd}', '{yyyy-mm-dd}', '{name}', '{ext}', '{index}'];
  const CONDITION_TYPES = ['domainContains', 'domainIs', 'minWidth', 'minHeight', 'fileType'];

  // Illegal on Windows/macOS filenames, plus control chars and the path separators.
  const ILLEGAL = /[<>:"|?*]/g;

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function stripControls(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) >= 32) out += s[i];
    return out;
  }

  function sanitizeSegment(s) {
    let out = stripControls(String(s == null ? '' : s)).replace(/[\\/]/g, '_').replace(ILLEGAL, '_');
    out = out.replace(/^\.+/, '').replace(/\.+$/, '').replace(/\s+/g, ' ').trim();
    if (out.length > 60) out = out.slice(0, 60).trim();
    return out;
  }

  function stemOf(filename) {
    const base = String(filename || '').split(/[\\/]/).pop() || '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
  }

  /** Expand a template's {tokens} against meta, then sanitize into a safe relative path. */
  function expand(template, meta) {
    const m = meta || {};
    const d = (m.date instanceof Date) ? m.date : new Date();
    const yyyy = '' + d.getFullYear(), mm = pad2(d.getMonth() + 1), dd = pad2(d.getDate());
    const map = {
      '{domain}': String(m.domain || 'unknown').replace(/^www\./, ''),
      '{yyyy}': yyyy, '{mm}': mm, '{dd}': dd, '{yyyy-mm-dd}': yyyy + '-' + mm + '-' + dd,
      '{name}': stemOf(m.filename) || ('image-' + ((m.index || 0) + 1)),
      '{ext}': String(m.ext || '').toLowerCase(),
      '{index}': '' + ((m.index || 0) + 1),
    };
    const raw = String(template || '').replace(/\{[a-z0-9-]+\}/gi, (tok) => (tok in map ? map[tok] : ''));
    // Split on slash, sanitize each segment, drop empties (collapses '//' and '..').
    return raw.split('/').map(sanitizeSegment).filter(Boolean).join('/');
  }

  function matchOne(c, meta) {
    const m = meta || {};
    const val = c && c.value;
    switch (c && c.type) {
      case 'domainContains': return String(m.domain || '').toLowerCase().indexOf(String(val || '').toLowerCase()) !== -1;
      case 'domainIs': return String(m.domain || '').replace(/^www\./, '').toLowerCase()
        === String(val || '').replace(/^www\./, '').toLowerCase();
      case 'minWidth': return (m.naturalWidth || m.displayWidth || 0) >= (parseInt(val, 10) || 0);
      case 'minHeight': return (m.naturalHeight || m.displayHeight || 0) >= (parseInt(val, 10) || 0);
      case 'fileType': return String(m.ext || '').toLowerCase() === String(val || '').toLowerCase().replace(/^\./, '');
      default: return false; // unknown condition never matches (fail closed)
    }
  }

  function matches(rule, meta) {
    const conds = (rule && rule.conditions) || [];
    if (!conds.length) return true; // catch-all
    return conds.every((c) => matchOne(c, meta));
  }

  /** First enabled matching rule's expanded folder, or '' (Downloads root). */
  function route(meta, rules) {
    const list = Array.isArray(rules) ? rules : [];
    for (const rule of list) {
      if (rule && rule.enabled !== false && matches(rule, meta)) return expand(rule.template || '', meta);
    }
    return '';
  }

  g.BID.folderRules = { TOKENS, CONDITION_TYPES, route, expand, matches, sanitizeSegment };
})();
