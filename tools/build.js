#!/usr/bin/env node
/**
 * tools/build.js — STUB (full implementation lands in M5).
 *
 * The extension runs unpacked with no build step. This script's only job — later — is to
 * assemble a clean, shippable zip: copy the runtime files (manifest, background, content,
 * results, options, welcome, shared, assets, _locales, vendor) into dist/, excluding dev-only
 * folders (docs, test, tools), and produce bulk-image-downloader-<version>.zip.
 *
 * For now it just prints the plan so `node tools/build.js` is never a hard error.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const RUNTIME_INCLUDE = [
  'manifest.json', 'background', 'content', 'results', 'options', 'welcome',
  'shared', 'assets', '_locales', 'vendor',
];
const DEV_EXCLUDE = ['docs', 'test', 'tools', 'node_modules', '.git', 'dist'];

console.log('Bulk Image Downloader — build stub');
console.log('version:', manifest.version);
console.log('would package (runtime):', RUNTIME_INCLUDE.join(', '));
console.log('would exclude (dev-only):', DEV_EXCLUDE.join(', '));
console.log('output (M5): dist/bulk-image-downloader-' + manifest.version + '.zip');
console.log('\nThis is a stub. The real zip assembly ships in milestone M5.');
