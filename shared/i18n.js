/**
 * shared/i18n.js — thin wrapper over chrome.i18n plus a DOM localizer.
 * Universal IIFE attaching to BID.i18n.
 *
 * HTML hooks (walked by apply()):
 *   data-i18n="key"                 -> element.textContent = message
 *   data-i18n-html="key"            -> element.innerHTML = message  (OUR strings only)
 *   data-i18n-attr-<attr>="key"     -> element.setAttribute(attr, message)
 *   data-i18n-<attr>="key"          -> shorthand for common attrs (title, placeholder, aria-label, alt, value)
 */
(function () {
  'use strict';
  const g = (typeof self !== 'undefined') ? self : this;
  g.BID = g.BID || {};

  const hasChromeI18n = (typeof chrome !== 'undefined') && chrome.i18n && chrome.i18n.getMessage;

  /** Get a localized message. `subs` may be a string or array of strings. */
  function t(key, subs) {
    if (hasChromeI18n) {
      const msg = chrome.i18n.getMessage(key, subs);
      if (msg) return msg;
    }
    // Fallback (e.g. opened as a plain file:// during testing): humanize the key.
    return key;
  }

  const SHORTHAND_ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'value'];

  /** Localize a DOM subtree in place. Safe to call multiple times. */
  function apply(root) {
    const scope = root || document;

    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });

    // Explicit attribute form: data-i18n-attr-<attr>
    scope.querySelectorAll('*').forEach((el) => {
      if (!el.attributes) return;
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith('data-i18n-attr-')) {
          const target = attr.name.slice('data-i18n-attr-'.length);
          el.setAttribute(target, t(attr.value));
        }
      }
    });

    // Shorthand attribute forms.
    for (const a of SHORTHAND_ATTRS) {
      scope.querySelectorAll(`[data-i18n-${a}]`).forEach((el) => {
        el.setAttribute(a, t(el.getAttribute(`data-i18n-${a}`)));
      });
    }

    // Reflect document language for a11y.
    if (scope === document && hasChromeI18n) {
      try { document.documentElement.lang = chrome.i18n.getUILanguage(); } catch (_) {}
    }
  }

  /** Auto-apply on DOM ready when loaded on a page. */
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => apply(document), { once: true });
    } else {
      apply(document);
    }
  }

  g.BID.i18n = { t, apply };
})();
