/**
 * results/zip.js — a tiny, dependency-free ZIP writer. BID.zip.
 *
 * STORE method only (no DEFLATE): the payload is already-compressed image bytes
 * (JPEG/PNG/WebP/…), which recompress to ~0% gain, so storing them uncompressed is
 * both correct and far smaller/faster than vendoring a full DEFLATE library.
 *
 * Format: standard PKZIP — local file headers + central directory + EOCD. 32-bit
 * sizes/offsets only (no ZIP64), which is fine under the caller's zipMaxBytes cap and
 * the < 65535 entry ceiling. Filenames are written UTF-8 (general-purpose flag bit 11).
 */
(function () {
  'use strict';
  const g = self;
  g.BID = g.BID || {};

  // --- CRC-32 (IEEE 802.3, reflected) ---------------------------------------
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // --- DOS date/time from a JS Date ------------------------------------------
  function dosTime(d) {
    return ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  }
  function dosDate(d) {
    const yr = Math.max(0, d.getFullYear() - 1980);
    return ((yr & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  }

  const ENC = new TextEncoder();
  const toBytes = (data) => (data instanceof Uint8Array) ? data
    : (data instanceof ArrayBuffer) ? new Uint8Array(data)
    : ENC.encode(String(data));

  /**
   * Build a ZIP Blob from files.
   * @param {Array<{name:string, data:Uint8Array|ArrayBuffer, date?:Date}>} files
   * @returns {Blob} application/zip
   */
  function create(files) {
    const chunks = [];       // ordered Uint8Array parts of the archive
    const central = [];      // central-directory records, appended after all locals
    let offset = 0;          // running offset of the next local header

    for (const f of files) {
      const nameBytes = ENC.encode(String(f.name || 'file'));
      const data = toBytes(f.data);
      const crc = crc32(data);
      const size = data.length;
      const d = f.date instanceof Date ? f.date : new Date();
      const time = dosTime(d), date = dosDate(d);

      // Local file header (30 bytes) + name + data.
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); // signature
      lh.setUint16(4, 20, true);         // version needed
      lh.setUint16(6, 0x0800, true);     // flags: UTF-8 filename
      lh.setUint16(8, 0, true);          // method: store
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);      // compressed size (== uncompressed for store)
      lh.setUint32(22, size, true);      // uncompressed size
      lh.setUint16(26, nameBytes.length, true);
      lh.setUint16(28, 0, true);         // extra length
      chunks.push(new Uint8Array(lh.buffer), nameBytes, data);

      // Central directory record (46 bytes) + name — buffered for later.
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); // signature
      ch.setUint16(4, 20, true);         // version made by
      ch.setUint16(6, 20, true);         // version needed
      ch.setUint16(8, 0x0800, true);     // flags: UTF-8
      ch.setUint16(10, 0, true);         // method: store
      ch.setUint16(12, time, true);
      ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, nameBytes.length, true);
      ch.setUint16(30, 0, true);         // extra length
      ch.setUint16(32, 0, true);         // comment length
      ch.setUint16(34, 0, true);         // disk number start
      ch.setUint16(36, 0, true);         // internal attrs
      ch.setUint32(38, 0, true);         // external attrs
      ch.setUint32(42, offset, true);    // local header offset
      central.push(new Uint8Array(ch.buffer), nameBytes);

      offset += 30 + nameBytes.length + size;
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const part of central) { chunks.push(part); cdSize += part.length; }

    // End of central directory (22 bytes).
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);              // disk number
    eocd.setUint16(6, 0, true);              // disk with central dir
    eocd.setUint16(8, files.length, true);   // entries on this disk
    eocd.setUint16(10, files.length, true);  // total entries
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, cdStart, true);
    eocd.setUint16(20, 0, true);             // comment length
    chunks.push(new Uint8Array(eocd.buffer));

    return new Blob(chunks, { type: 'application/zip' });
  }

  g.BID.zip = { create, crc32 };
})();
