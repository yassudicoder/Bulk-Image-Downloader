/**
 * results/dedupe.js — perceptual duplicate detection. BID.dedupe.
 *
 * dHash (difference hash): decode each image, downscale to 9x8 grayscale, and emit a
 * 64-bit hash from left>right luminance comparisons. Two images are "duplicates" when
 * their hashes are within a Hamming distance <= threshold (byte-identical images collapse
 * at distance 0). Grouping is union-find: O(n) for identical hashes plus an O(n^2)
 * near-duplicate pass, capped so huge scans stay responsive.
 *
 * Bytes come from BID.imageBytes (the same hybrid-permission fetch the ZIP feature uses).
 * Runs on the results page, so createImageBitmap + OffscreenCanvas are available.
 */
(function () {
  'use strict';
  const g = self;
  g.BID = g.BID || {};

  const HASH_BYTES = 8;              // 64-bit dHash
  const GRID_W = 9, GRID_H = 8;      // 9x8 => 8 comparisons per row * 8 rows = 64 bits
  const PAIRWISE_CAP = 3000;         // skip the O(n^2) near-dup pass above this many hashes

  // Precomputed 8-bit popcount for fast Hamming distance.
  const POPCOUNT = (function () {
    const t = new Uint8Array(256);
    for (let i = 0; i < 256; i++) t[i] = (i & 1) + t[i >> 1];
    return t;
  })();

  function hamming(a, b) {
    let d = 0;
    for (let i = 0; i < HASH_BYTES; i++) d += POPCOUNT[a[i] ^ b[i]];
    return d;
  }

  function toHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) { const h = bytes[i].toString(16); s += h.length < 2 ? '0' + h : h; }
    return s;
  }

  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  /** Compute a dHash for raw image bytes. Returns Uint8Array(8). Throws if undecodable. */
  async function dhash(bytes) {
    const blob = (bytes instanceof Blob) ? bytes : new Blob([bytes]);
    // Downscale during decode so we never hold a full-size bitmap in memory.
    const bmp = await createImageBitmap(blob, {
      resizeWidth: GRID_W, resizeHeight: GRID_H, resizeQuality: 'high',
    });
    try {
      const canvas = new OffscreenCanvas(GRID_W, GRID_H);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, GRID_W, GRID_H);
      const data = ctx.getImageData(0, 0, GRID_W, GRID_H).data;

      const hash = new Uint8Array(HASH_BYTES);
      let bit = 0;
      for (let y = 0; y < GRID_H; y++) {
        let left = lum(data, (y * GRID_W) * 4);
        for (let x = 1; x < GRID_W; x++) {
          const cur = lum(data, (y * GRID_W + x) * 4);
          if (left > cur) hash[bit >> 3] |= (1 << (bit & 7));
          left = cur;
          bit++;
        }
      }
      return hash;
    } finally {
      if (bmp.close) bmp.close();
    }
  }

  /**
   * Hash a batch of fetched images with bounded concurrency.
   * @param {Array<{item, bytes:Uint8Array}>} okList
   * @returns {Promise<Array<{item, hash:Uint8Array|null, bytes:number}>>}
   */
  async function hashAll(okList, opts) {
    const options = opts || {};
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const concurrency = Math.max(1, options.concurrency || 8);
    const out = [];
    let done = 0, cursor = 0;

    async function worker() {
      while (cursor < okList.length) {
        const { item, bytes } = okList[cursor++];
        let hash = null;
        try { hash = await dhash(bytes); } catch (_) { hash = null; }
        out.push({ item, hash, bytes: bytes ? bytes.length : 0 });
        done++;
        if (onProgress) onProgress(done, okList.length);
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, okList.length) }, worker));
    return out;
  }

  /**
   * Group duplicates and tag each candidate with a `_dupGroup` key (null when unique or
   * undecodable) plus `_dupBytes` for later representative tie-breaking. The controller
   * decides which member to keep at render time. Mutates the candidate objects.
   * @returns {{dupCount:number, groupCount:number, limited:boolean}}
   */
  function markDuplicates(hashed, threshold) {
    for (const h of hashed) { h.item._dupGroup = null; h.item._dupBytes = h.bytes || 0; }

    const withHash = hashed.filter((h) => h.hash);
    const n = withHash.length;
    const parent = new Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };

    // Byte-identical images (same dHash) union in O(n).
    const seen = new Map();
    for (let i = 0; i < n; i++) {
      const hex = toHex(withHash[i].hash);
      if (seen.has(hex)) union(i, seen.get(hex)); else seen.set(hex, i);
    }

    // Near-duplicate pass (skipped when threshold is 0 or the set is huge).
    let limited = false;
    if (threshold > 0) {
      if (n <= PAIRWISE_CAP) {
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            if (find(i) === find(j)) continue;
            if (hamming(withHash[i].hash, withHash[j].hash) <= threshold) union(i, j);
          }
        }
      } else {
        limited = true;
      }
    }

    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      let arr = groups.get(r);
      if (!arr) { arr = []; groups.set(r, arr); }
      arr.push(withHash[i].item);
    }

    let dupCount = 0, groupCount = 0, gid = 0;
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      const key = 'g' + (gid++);
      for (const it of arr) it._dupGroup = key;
      groupCount++;
      dupCount += arr.length - 1;
    }
    return { dupCount, groupCount, limited };
  }

  g.BID.dedupe = { dhash, hashAll, markDuplicates, hamming, toHex, PAIRWISE_CAP };
})();
