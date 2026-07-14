/**
 * shared/entitlements.js — feature-flag scaffold.
 * Universal IIFE attaching to BID.entitlements.
 *
 * During beta, BETA_ALL_FREE flips every Pro flag on. The gating call sites exist from
 * v0.1 so wiring payment later touches only this file. Free tier PERMANENTLY includes:
 * full scan, filters, on-page dedupe, unlimited individual downloads. The begged-for
 * feature (dedupe) is never fully paywalled.
 */
(function () {
  'use strict';
  const g = (typeof self !== 'undefined') ? self : this;
  g.BID = g.BID || {};

  const BETA_ALL_FREE = true;

  // Pro-flagged capabilities (scaffolded now, enforced in later milestones).
  const FLAGS = Object.freeze({
    crossSessionDedupe: 'crossSessionDedupe', // M2: persistent hash index + "downloaded before"
    folderRules: 'folderRules',               // M3: onDeterminingFilename routing
    bulkZipOver50: 'bulkZipOver50',           // M3: zip beyond 50 images
  });

  // In-memory pro state; a real build would hydrate this from a verified receipt.
  let _pro = false;

  function isPro() { return BETA_ALL_FREE || _pro; }

  function isEnabled(flag) {
    if (BETA_ALL_FREE) return true;
    switch (flag) {
      case FLAGS.crossSessionDedupe:
      case FLAGS.folderRules:
      case FLAGS.bulkZipOver50:
        return _pro;
      default:
        return true; // unknown flag => treat as free capability
    }
  }

  function setProState(v) { _pro = !!v; }

  g.BID.entitlements = { BETA_ALL_FREE, FLAGS, isPro, isEnabled, setProState };
})();
