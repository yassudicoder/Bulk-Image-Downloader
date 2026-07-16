/**
 * results/downloads.js — individual downloads via chrome.downloads. BID.downloads.
 *
 * Individual downloads are NOT subject to page CORS (the browser fetches the URL), so they
 * work even for CORS-hostile CDNs — unlike pixel hashing (that's the M2 problem). Folder
 * routing and ZIP land in M3; here we save each file to the Downloads root with a safe,
 * de-collided name.
 */
(function () {
  'use strict';
  const g = self;
  g.BID = g.BID || {};

  const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  const MAX_NAME = 120;
  // Illegal filename chars on Windows/macOS (printable). Control chars are stripped
  // separately by char code so no control bytes ever appear in this source file.
  const ILLEGAL = /[<>:"/\\|?*]/g;

  function stripControls(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) >= 32) out += s[i];
    }
    return out;
  }

  function sanitizeFilename(name, fallbackExt, index) {
    let base = String(name || '').split(/[\\/]/).pop() || '';
    base = stripControls(base).replace(ILLEGAL, '_');
    base = base.replace(/^\.+/, '');          // no leading dots (blocks "..")
    base = base.replace(/\s+/g, ' ').trim();

    // Split stem/ext to enforce a sane extension and length.
    let stem = base, ext = '';
    const dot = base.lastIndexOf('.');
    if (dot > 0) {
      stem = base.slice(0, dot);
      ext = base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    if (!ext && fallbackExt) ext = String(fallbackExt).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (WIN_RESERVED.test(stem)) stem = '_' + stem;
    if (!stem) stem = 'image-' + (index != null ? index + 1 : 1);
    if (stem.length > MAX_NAME) stem = stem.slice(0, MAX_NAME);

    return ext ? (stem + '.' + ext) : stem;
  }

  function filenameFor(candidate, index) {
    const ext = candidate.ext || '';
    let name = candidate.filename;
    if (!name) {
      const domainBit = (candidate.domain && candidate.domain !== 'data:' && candidate.domain !== 'blob:')
        ? candidate.domain.replace(/^www\./, '').split('.')[0]
        : 'image';
      name = domainBit + '-' + (index != null ? index + 1 : 1);
    }
    return sanitizeFilename(name, ext || 'jpg', index);
  }

  function downloadOne(candidate, index, folder) {
    return new Promise((resolve) => {
      let filename;
      try {
        filename = filenameFor(candidate, index);
        if (folder) filename = folder + '/' + filename;   // route into a Downloads subfolder
      } catch (_) { filename = 'image-' + ((index || 0) + 1); }
      try {
        chrome.downloads.download(
          { url: candidate.url, filename: filename, conflictAction: 'uniquify' },
          (downloadId) => {
            const err = chrome.runtime.lastError;
            if (err || downloadId == null) resolve({ ok: false, item: candidate, error: err ? err.message : 'no_id' });
            else resolve({ ok: true, item: candidate, id: downloadId });
          },
        );
      } catch (e) {
        resolve({ ok: false, item: candidate, error: e && e.message ? e.message : 'exception' });
      }
    });
  }

  /**
   * Download many with bounded concurrency. Resolves { started, failed:[{item,error}], total }.
   * onProgress(done, total) fires as each settles.
   */
  async function downloadMany(items, opts) {
    const options = opts || {};
    const concurrency = Math.max(1, options.concurrency || 6);
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

    const total = items.length;
    let done = 0, started = 0;
    const failed = [];
    let cursor = 0;

    async function worker() {
      while (cursor < items.length) {
        const idx = cursor++;
        let folder = '';
        try { if (options.folderFor) folder = options.folderFor(items[idx], idx) || ''; } catch (_) { folder = ''; }
        const res = await downloadOne(items[idx], idx, folder);
        if (res.ok) started++;
        else failed.push({ item: res.item, error: res.error });
        done++;
        if (onProgress) onProgress(done, total);
      }
    }

    const pool = [];
    for (let i = 0; i < Math.min(concurrency, items.length); i++) pool.push(worker());
    await Promise.all(pool);
    return { started: started, failed: failed, total: total };
  }

  g.BID.downloads = { sanitizeFilename, filenameFor, downloadOne, downloadMany };
})();
