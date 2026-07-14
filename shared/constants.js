/**
 * shared/constants.js — single source of truth for cross-module constants.
 *
 * Universal IIFE: attaches to `self.BID` in pages, service worker (via importScripts),
 * and any classic-script context. Content scripts do NOT load this (they inline the few
 * constants they need); those inlined values MUST match what's here.
 */
(function () {
  'use strict';
  const g = (typeof self !== 'undefined') ? self : this;
  g.BID = g.BID || {};

  const MSG = Object.freeze({
    SCAN_RESULT: 'BID_SCAN_RESULT',   // scanner -> service worker
    SCAN_ERROR: 'BID_SCAN_ERROR',     // scanner -> service worker
    OPEN_OPTIONS: 'BID_OPEN_OPTIONS', // page -> service worker
  });

  const STORAGE = Object.freeze({
    scanPrefix: 'scan:',              // chrome.storage.session
    settings: 'bid:settings',         // chrome.storage.local
    analyticsOptIn: 'bid:analyticsOptIn',
    dedupeHistory: 'bid:dedupeHistory', // M2
    folderRules: 'bid:folderRules',     // M3
    installMeta: 'bid:installMeta',
  });

  // Candidate discovery sources. Keep in sync with content/scanner.js.
  const SOURCE_TYPES = Object.freeze({
    IMG: 'img',
    SRCSET: 'srcset',
    PICTURE: 'picture',
    BACKGROUND: 'background',
    LAZY: 'lazy',
    SHADOW: 'shadow',
  });

  // Lazy-load attributes the scanner probes, in priority order.
  const LAZY_ATTRS = Object.freeze(['data-src', 'data-original', 'data-lazy-src']);

  // Recognized raster/vector image extensions (lowercased, no dot).
  const IMAGE_EXTS = Object.freeze([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'tiff', 'tif',
  ]);

  const DEFAULTS = Object.freeze({
    // Dedupe (M2) — scaffolded here so options/settings shape is stable from v0.1.
    dedupeHammingThreshold: 6,
    // Grid
    thumbSize: 150,          // px, CSS --bid-thumb-size default
    // Zip (M3)
    zipConcurrency: 4,
    zipMaxBytes: 500 * 1024 * 1024,
    freeZipLimit: 50,
    // Cross-session index (M2)
    dedupeHistoryCap: 50000,
    // Locale ('' = follow browser UI locale)
    locale: '',
  });

  const LIMITS = Object.freeze({
    // Guardrail: refuse absurd scans so a hostile page can't OOM us.
    maxCandidates: 20000,
    minUsefulDimension: 1, // px; a 0- or 1-px tracking pixel is still recorded but filterable
  });

  g.BID.constants = Object.freeze({
    MSG, STORAGE, SOURCE_TYPES, LAZY_ATTRS, IMAGE_EXTS, DEFAULTS, LIMITS,
    EXT_VERSION: '0.1.0',
  });
})();
