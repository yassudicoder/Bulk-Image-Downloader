/* Bulk Image Downloader — site engine, pass 2: "one continuous machine".
   Vanilla JS, no dependencies (same rule as the extension itself).
   One canonical asset set travels through every scene: the hero discovers
   them, the filter narrows them, dedupe collapses them, the zip receives
   the survivors. Everything animates with transform/opacity; scroll work
   is rAF-throttled. */
(function () {
  "use strict";

  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var FINE = window.matchMedia("(pointer:fine)").matches;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ---------------------------------------------------------------
     Seeded thumbnail art. Every "image" on the site is generated —
     tiny deterministic SVG compositions that read as a varied photo
     collection without shipping a single raster asset.
     --------------------------------------------------------------- */
  function rng(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  var PALS = [
    ["#9db89a", "#5f7d62", "#2e4634", "#e6e0c8"],
    ["#c9b48a", "#987f54", "#5d4f33", "#efe8d2"],
    ["#8fa6b0", "#5b7684", "#2f4550", "#e3e6de"],
    ["#b89a92", "#8a6157", "#54372f", "#ecdfd4"],
    ["#a3a68e", "#6f7358", "#3f4231", "#e9e7d3"],
    ["#7f9c94", "#4d6e66", "#26403a", "#dde5dd"]
  ];
  function art(seed, kind, w, h) {
    var r = rng(seed), p = PALS[Math.floor(r() * PALS.length)];
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + " " + h + '" role="img" aria-hidden="true">';
    if (kind === "photo") {
      s += '<rect width="' + w + '" height="' + h + '" fill="' + p[3] + '"/>';
      s += '<circle cx="' + (w * (0.2 + r() * 0.6)).toFixed(0) + '" cy="' + (h * (0.2 + r() * 0.25)).toFixed(0) + '" r="' + (h * 0.13).toFixed(0) + '" fill="' + p[0] + '"/>';
      var base = h * (0.55 + r() * 0.15);
      s += '<path d="M0 ' + h + " L0 " + base.toFixed(0) + " L" + (w * 0.33).toFixed(0) + " " + (base - h * 0.28).toFixed(0) + " L" + (w * 0.6).toFixed(0) + " " + base.toFixed(0) + " L" + w + " " + (base - h * 0.16).toFixed(0) + " L" + w + " " + h + ' Z" fill="' + p[1] + '"/>';
      s += '<path d="M0 ' + h + " L0 " + (base + h * 0.14).toFixed(0) + " L" + (w * 0.5).toFixed(0) + " " + (base + h * 0.02).toFixed(0) + " L" + w + " " + (base + h * 0.2).toFixed(0) + " L" + w + " " + h + ' Z" fill="' + p[2] + '"/>';
    } else if (kind === "product") {
      s += '<rect width="' + w + '" height="' + h + '" fill="' + p[3] + '"/>';
      var pw = w * (0.34 + r() * 0.2), ph = h * (0.45 + r() * 0.22);
      var px = (w - pw) / 2, py = h * 0.62 - ph / 2;
      s += '<ellipse cx="' + w / 2 + '" cy="' + (py + ph + h * 0.06).toFixed(0) + '" rx="' + (pw * 0.62).toFixed(0) + '" ry="' + (h * 0.045).toFixed(0) + '" fill="' + p[2] + '" opacity=".28"/>';
      s += '<rect x="' + px.toFixed(0) + '" y="' + py.toFixed(0) + '" width="' + pw.toFixed(0) + '" height="' + ph.toFixed(0) + '" rx="' + (Math.min(pw, ph) * 0.16).toFixed(0) + '" fill="' + p[r() > 0.5 ? 0 : 1] + '"/>';
      s += '<rect x="' + (px + pw * 0.16).toFixed(0) + '" y="' + (py + ph * 0.2).toFixed(0) + '" width="' + (pw * 0.68).toFixed(0) + '" height="' + (ph * 0.14).toFixed(0) + '" fill="' + p[3] + '" opacity=".7"/>';
    } else if (kind === "texture") {
      s += '<rect width="' + w + '" height="' + h + '" fill="' + p[2] + '"/>';
      var n = 5 + Math.floor(r() * 4), i;
      for (i = 0; i < n; i++) {
        s += '<rect x="' + (w / n * i).toFixed(1) + '" width="' + (w / n * 0.55).toFixed(1) + '" height="' + h + '" fill="' + p[i % 2] + '" opacity="' + (0.5 + r() * 0.5).toFixed(2) + '"/>';
      }
    } else if (kind === "portrait") {
      s += '<rect width="' + w + '" height="' + h + '" fill="' + p[1] + '"/>';
      s += '<path d="M0 ' + h + " L0 " + (h * 0.42).toFixed(0) + " Q" + w / 2 + " " + (-h * 0.15).toFixed(0) + " " + w + " " + (h * 0.42).toFixed(0) + " L" + w + " " + h + ' Z" fill="' + p[3] + '" opacity=".25"/>';
      s += '<circle cx="' + w / 2 + '" cy="' + (h * 0.4).toFixed(0) + '" r="' + (Math.min(w, h) * 0.2).toFixed(0) + '" fill="' + p[3] + '"/>';
      s += '<path d="M' + (w * 0.2).toFixed(0) + " " + h + " Q" + w / 2 + " " + (h * 0.55).toFixed(0) + " " + (w * 0.8).toFixed(0) + " " + h + ' Z" fill="' + p[0] + '"/>';
    } else { /* chart */
      s += '<rect width="' + w + '" height="' + h + '" fill="' + p[3] + '"/>';
      var bars = 5, j;
      for (j = 0; j < bars; j++) {
        var bh = h * (0.2 + r() * 0.6);
        s += '<rect x="' + (w * (0.1 + j * 0.17)).toFixed(0) + '" y="' + (h * 0.9 - bh).toFixed(0) + '" width="' + (w * 0.1).toFixed(0) + '" height="' + bh.toFixed(0) + '" fill="' + p[j % 3] + '"/>';
      }
    }
    return s + "</svg>";
  }

  /* ---------------------------------------------------------------
     THE CANONICAL ASSET SET.
     These 24 objects are the images the whole site processes. The hero
     discovers a subset, the filter narrows all 24, dedupe collapses
     copies of asset #0, and the zip receives the survivors — the same
     art, the same metadata, traveling through the machine.
     --------------------------------------------------------------- */
  function A(id, name, kind, w, h, ext, dom, seed) {
    return { id: id, name: name, kind: kind, w: w, h: h, ext: ext, dom: dom, seed: seed,
      kb: Math.max(8, Math.round(w * h / (ext === "JPG" ? 4100 : 2900))) };
  }
  var ASSETS = [
    A(0, "hero-banner", "photo", 1600, 1067, "JPG", "example.com", 777),
    A(1, "product-front", "product", 1200, 1200, "PNG", "example.com", 37),
    A(2, "product-side", "product", 1200, 1200, "PNG", "example.com", 71),
    A(3, "detail-macro", "photo", 1600, 900, "JPG", "images.example.com", 11),
    A(4, "lifestyle-01", "photo", 2400, 1350, "JPG", "images.example.com", 53),
    A(5, "lifestyle-02", "photo", 1920, 1080, "JPG", "example.com", 97),
    A(6, "swatch-oak", "texture", 800, 800, "WEBP", "example.com", 23),
    A(7, "size-chart", "chart", 900, 600, "SVG", "example.com", 67),
    A(8, "portrait-team", "portrait", 800, 1200, "JPG", "example.com", 41),
    A(9, "texture-linen", "texture", 1024, 768, "PNG", "images.example.com", 139),
    A(10, "gallery-04", "photo", 1600, 1067, "JPG", "example.com", 127),
    A(11, "chart-q2", "chart", 480, 480, "GIF", "example.com", 131),
    A(12, "product-pack", "product", 1400, 930, "PNG", "example.com", 113),
    A(13, "portrait-cta", "portrait", 640, 960, "JPG", "cdn.shoplet.io", 101),
    A(14, "banner-wide", "photo", 2000, 900, "JPG", "example.com", 211),
    A(15, "swatch-slate", "texture", 600, 600, "WEBP", "cdn.shoplet.io", 83),
    A(16, "icon-cart", "product", 96, 96, "SVG", "example.com", 223),
    A(17, "thumb-related", "photo", 320, 240, "JPG", "cdn.shoplet.io", 227),
    A(18, "gallery-05", "photo", 1200, 800, "JPG", "images.example.com", 229),
    A(19, "promo-tile", "product", 960, 1280, "PNG", "ads.thirdparty.net", 233),
    A(20, "badge-sale", "chart", 240, 240, "GIF", "ads.thirdparty.net", 239),
    A(21, "portrait-review", "portrait", 480, 720, "JPG", "ads.thirdparty.net", 241),
    A(22, "texture-paper", "texture", 1400, 1050, "PNG", "example.com", 251),
    A(23, "product-detail", "product", 800, 533, "JPG", "images.example.com", 257)
  ];
  ASSETS[0].kb = 412; // the hero-banner's size is quoted in the dedupe scene — keep them identical
  // mirrors filters.js baseDomain(): sub-domains of the page count as the page
  function samePage(dom) { return /(^|\.)example\.com$/.test(dom); }
  // the zip receives what survives a plausible pass: on-page, ≥800px wide
  var SURVIVORS = ASSETS.filter(function (a) { return samePage(a.dom) && a.w >= 800; }).slice(0, 8);

  function figHTML(a, px) {
    return "<figure>" + art(a.seed, a.kind, px, Math.round(px * a.h / a.w)) + "</figure>";
  }
  function dims(a) { return a.w + "×" + a.h; }

  /* ---------------------------------------------------------------
     HERO — scanline discovers a field of assets (subset of the set)
     --------------------------------------------------------------- */
  var HERO_TILES = [
    // [x%, y%, w px, assetId, depth]
    [4, 8, 130, 3, 2], [21, 5, 96, 6, 1], [38, 9, 118, 1, 3], [56, 4, 88, 13, 1],
    [70, 10, 140, 4, 3], [88, 6, 92, 7, 2], [82, 30, 120, 2, 2], [92, 52, 96, 15, 1],
    [80, 72, 128, 5, 3], [63, 84, 100, 8, 2], [40, 88, 112, 12, 1], [18, 84, 124, 0, 3],
    [3, 62, 96, 11, 1], [2, 34, 110, 9, 2]
  ];
  function buildHero() {
    var field = $("#heroField");
    if (!field) return;
    var mobile = window.innerWidth < 760;
    HERO_TILES.forEach(function (t) {
      // small screens: only bold tiles in the top band, clear of the copy and CTA
      if (mobile && (t[4] < 2 || t[1] > 12)) return;
      var a = ASSETS[t[3]];
      var el = document.createElement("div");
      el.className = "tile";
      el.style.left = t[0] + "%";
      el.style.top = t[1] + "%";
      el.style.width = (mobile ? t[2] * 0.58 : t[2]) + "px";
      el.style.setProperty("--td", (t[1] / 100 * 1.55).toFixed(2) + "s");
      el.style.setProperty("--o", t[4] === 3 ? 1 : t[4] === 2 ? 0.85 : 0.6);
      el.dataset.depth = t[4];
      el.dataset.tip = "VIEW " + dims(a) + " " + a.ext;
      el.innerHTML = "<figure>" + art(a.seed, a.kind, 160, Math.round(160 * a.h / a.w)) +
        '<span class="tag"><span>' + a.name + "." + a.ext.toLowerCase() + "</span><span>" + dims(a) + "</span></span></figure>";
      field.appendChild(el);
    });

    var hero = $("#hero");
    var counter = $("#heroCount");
    if (REDUCED) { hero.classList.add("done", "reveal"); if (counter) counter.textContent = "247"; return; }
    setTimeout(function () {
      hero.classList.add("scanning");
      $$(".tile", field).forEach(function (el) { el.classList.add("found"); });
      tick(counter, 0, 247, 1650);
      setTimeout(function () { hero.classList.add("reveal"); }, 620);
      setTimeout(function () { hero.classList.add("done"); }, 1800);
    }, 350);

    if (FINE) {
      var raf = null, mx = 0, my = 0;
      hero.addEventListener("pointermove", function (e) {
        mx = e.clientX / window.innerWidth - 0.5;
        my = e.clientY / window.innerHeight - 0.5;
        if (!raf) raf = requestAnimationFrame(function () {
          raf = null;
          $$(".tile", field).forEach(function (el) {
            var d = +el.dataset.depth;
            el.style.translate = (mx * d * -7).toFixed(1) + "px " + (my * d * -5).toFixed(1) + "px";
          });
        });
      });
    }
  }

  function tick(el, from, to, ms, pad) {
    if (!el) return;
    if (REDUCED) { el.textContent = pad ? String(to).padStart(pad, "0") : String(to); return; }
    var t0 = performance.now();
    (function step(t) {
      var p = Math.min(1, (t - t0) / ms);
      var eased = 1 - Math.pow(1 - p, 3);
      var v = Math.round(from + (to - from) * eased);
      el.textContent = pad ? String(v).padStart(pad, "0") : String(v);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ---------------------------------------------------------------
     STAGE 01 — layer explosion, then FLATTEN: the exploded page
     collapses into a flat grid as you leave, handing off to FILTER
     --------------------------------------------------------------- */
  var LAYER_COUNTS = [132, 41, 38, 29, 7]; // img / srcset / css bg / lazy / shadow = 247
  function initScan() {
    var sec = $("#scan");
    var stack = $("#stack");
    if (!sec || !stack) return;
    $$(".layer", stack).forEach(function (layer, li) {
      var r = rng(400 + li * 17), n = 4 + Math.floor(r() * 4), i;
      for (i = 0; i < n; i++) {
        var b = document.createElement("i");
        b.className = "blob";
        var bw = 8 + r() * 16, bh = 6 + r() * 12;
        b.style.cssText = "width:" + bw.toFixed(0) + "%;height:" + bh.toFixed(0) + "%;left:" +
          (r() * (92 - bw)).toFixed(0) + "%;top:" + (r() * (88 - bh)).toFixed(0) + "%";
        layer.appendChild(b);
      }
    });
    var layers = $$(".layer", stack);
    var legends = $$(".legend .lg");
    var legend = $("#legend");
    var readC = $("#scanCount");
    var readout = $(".scan-readout .m", sec);
    var lastN = -1, lastFlat = -1;
    function update() {
      var r = sec.getBoundingClientRect();
      var total = r.height - window.innerHeight;
      var p = Math.max(0, Math.min(1, -r.top / total));
      // phase 1 (0 → .68): explode. phase 2 (.68 → 1): flatten into a grid.
      var ex = Math.min(1, p / 0.68);
      var fl = Math.max(0, (p - 0.72) / 0.28);
      stack.style.setProperty("--sep", ((ex * 68) * (1 - fl) + fl * 8).toFixed(1) + "px");
      stack.style.setProperty("--rx", (56 - fl * 44).toFixed(1) + "deg");
      stack.style.setProperty("--rz", (-14 + fl * 12).toFixed(1) + "deg");
      if (legend) legend.style.opacity = String(Math.max(0, 1 - fl * 1.6).toFixed(2));
      var flat = fl > 0.55 ? 1 : 0;
      if (flat !== lastFlat) {
        lastFlat = flat;
        stack.classList.toggle("flatten", !!flat);
        if (readout) readout.classList.toggle("handoff", !!flat);
        if (readout && flat) readout.innerHTML = '247 assets → <span class="c">forwarding to filter</span>';
        else if (readout) readout.innerHTML = 'assets discovered <span class="c" id="scanCount">' + (readC ? readC.textContent : "0") + "</span> / 247";
        readC = $("#scanCount");
      }
      var lit = Math.floor(Math.min(1, ex) * (layers.length + 0.6));
      if (lit !== lastN) {
        lastN = lit;
        var sum = 0;
        layers.forEach(function (l, i) {
          var on = i < lit;
          l.classList.toggle("lit", on);
          if (on) sum += LAYER_COUNTS[i];
        });
        legends.forEach(function (g) { g.classList.toggle("lit", +g.dataset.i < lit); });
        if (readC) readC.textContent = String(sum);
      }
    }
    onScroll(update); update();
  }

  /* ---------------------------------------------------------------
     STAGE 02 — the filter playground (working miniature of
     results/filters.js) over the SAME canonical assets
     --------------------------------------------------------------- */
  function initPlayground() {
    var grid = $("#pgrid");
    if (!grid) return;
    ASSETS.forEach(function (d) {
      var el = document.createElement("div");
      el.className = "pcard";
      el.dataset.id = d.id;
      el.dataset.tip = dims(d) + " · " + d.ext;
      el.innerHTML = "<figure>" + art(d.seed, d.kind, 140, Math.round(140 * d.h / d.w)) + "</figure>" +
        '<div class="meta"><span>' + dims(d) + '</span><span class="ext">' + d.ext + "</span></div>" +
        '<div class="meta"><span>' + d.dom + "</span></div>";
      grid.appendChild(el);
    });
    var cards = $$(".pcard", grid);
    var range = $("#fWidth"), rangeOut = $("#fWidthOut");
    var typeChips = $$("#fTypes .chip");
    var pageOnly = $("#fPage");
    var countEl = $("#fCount"), reset = $("#fReset");
    var empty = $("#pgridEmpty");
    var state = { minW: 0, type: "", page: false };

    function apply(animate) {
      var first = {};
      if (animate && !REDUCED) cards.forEach(function (c) {
        if (!c.classList.contains("out")) first[c.dataset.id] = c.getBoundingClientRect();
      });
      var shown = 0;
      cards.forEach(function (c) {
        var d = ASSETS[+c.dataset.id];
        var ok = d.w >= state.minW &&
          (!state.type || d.ext === state.type) &&
          (!state.page || samePage(d.dom));
        var was = !c.classList.contains("out");
        c.classList.toggle("out", !ok);
        if (ok) { shown++; if (!was && animate && !REDUCED) c.classList.add("enter"); }
      });
      if (empty) empty.style.display = shown ? "none" : "block";
      if (countEl) {
        countEl.innerHTML = "<b>" + shown + "</b> of " + ASSETS.length + " shown";
        if (animate && !REDUCED) {
          countEl.classList.remove("bump"); void countEl.offsetWidth; countEl.classList.add("bump");
        }
      }
      if (animate && !REDUCED) {
        cards.forEach(function (c) {
          var f = first[c.dataset.id];
          if (!f || c.classList.contains("out")) return;
          var l = c.getBoundingClientRect();
          var dx = f.left - l.left, dy = f.top - l.top;
          if (!dx && !dy) return;
          c.classList.remove("flip");
          c.style.transform = "translate(" + dx + "px," + dy + "px)";
          void c.offsetWidth;
          c.classList.add("flip");
          c.style.transform = "";
        });
        setTimeout(function () { cards.forEach(function (c) { c.classList.remove("enter", "flip"); }); }, 420);
      }
    }
    if (range) range.addEventListener("input", function () {
      state.minW = +range.value;
      if (rangeOut) rangeOut.textContent = state.minW ? "≥ " + state.minW + "px" : "any size";
      apply(true);
    });
    typeChips.forEach(function (ch) {
      ch.addEventListener("click", function () {
        typeChips.forEach(function (o) { o.setAttribute("aria-pressed", o === ch ? "true" : "false"); });
        state.type = ch.dataset.t || "";
        apply(true);
      });
    });
    if (pageOnly) pageOnly.addEventListener("change", function () { state.page = pageOnly.checked; apply(true); });
    if (reset) reset.addEventListener("click", function () {
      state = { minW: 0, type: "", page: false };
      if (range) { range.value = 0; }
      if (rangeOut) rangeOut.textContent = "any size";
      typeChips.forEach(function (o) { o.setAttribute("aria-pressed", o.dataset.t === "" ? "true" : "false"); });
      if (pageOnly) pageOnly.checked = false;
      apply(true);
    });
    apply(false);
  }

  /* ---------------------------------------------------------------
     STAGE 03 — DEDUPE: watch the algorithm think.
     Fingerprint each candidate, compare bit-by-bit against the keeper
     with a live Hamming counter, converge matches into the cluster,
     send the genuinely-different image away. Asset #0 is the keeper —
     the same hero-banner discovered in the hero and kept by the filter.
     --------------------------------------------------------------- */
  var KEEP_HEX = "c3a5e1708f4b2d96";
  function hexBits(hex) {
    var out = [], i;
    for (i = 0; i < 64; i++) out.push((parseInt(hex[Math.floor(i / 4)], 16) >> (3 - i % 4)) & 1);
    return out;
  }
  function flipBits(bits, positions) {
    var b = bits.slice();
    positions.forEach(function (p) { b[p] = b[p] ? 0 : 1; });
    return b;
  }
  var KEEP_BITS = hexBits(KEEP_HEX);
  var DD = [
    // scatter x/y/rot, merged x/y/rot, w, label, bits, verdict
    { x: "58%", y: "6%", r: "4deg", mx: "66%", my: "24%", mr: "6deg", w: 150,
      lab: "1200×800 · 240 KB", bits: flipBits(KEEP_BITS, [13, 37, 55]) },
    { x: "72%", y: "48%", r: "-7deg", mx: "34%", my: "52%", mr: "-8deg", w: 120,
      lab: "800×533 · 96 KB", bits: flipBits(KEEP_BITS, [9, 44]) },
    { x: "30%", y: "58%", r: "6deg", mx: "67%", my: "54%", mr: "7deg", w: 120,
      lab: "800×533 · 61 KB · q60", bits: flipBits(KEEP_BITS, [3, 18, 33, 58]) },
    { x: "8%", y: "60%", r: "3deg", mx: "32%", my: "26%", mr: "-6deg", w: 90,
      lab: "400×267 · 28 KB", bits: flipBits(KEEP_BITS, [5, 21, 40, 50, 60]) },
    { x: "44%", y: "34%", r: "-3deg", mx: "84%", my: "72%", mr: "2deg", w: 104, diff: true,
      lab: "texture-linen · 1024×768",
      bits: flipBits(KEEP_BITS, [1, 3, 6, 8, 10, 13, 15, 18, 20, 23, 25, 28, 30, 33, 35,
        38, 40, 42, 45, 47, 50, 52, 54, 56, 58, 60, 12, 26, 44, 61, 62]) } // exactly 31 bits apart
  ];
  function renderBits(el, bits, cls) {
    el.innerHTML = bits.map(function (v, i) {
      return "<i data-i='" + i + "' class='" + (v ? "b1" : "") + (cls ? " " + cls : "") + "'></i>";
    }).join("");
  }
  function initDedupe() {
    var stage = $("#ddStage");
    if (!stage) return;
    var status = $("#ddStatus");
    var keeper = document.createElement("div");
    keeper.className = "variant keepv";
    keeper.style.cssText = "--vw:190px;--x:8%;--y:8%;--r:-5deg;--mx:50%;--my:30%;--mr:0deg;--z:9";
    keeper.dataset.tip = "ORIGINAL · 1600×1067";
    keeper.innerHTML = figHTML(ASSETS[0], 160).replace("</figure>",
      '<span class="badge keep">KEEP</span><span class="meta"><span>1600×1067 · 412 KB</span></span></figure>');
    stage.appendChild(keeper);
    var vEls = DD.map(function (v, i) {
      var el = document.createElement("div");
      el.className = "variant" + (v.diff ? " diffv" : " dupv");
      el.style.cssText = "--vw:" + v.w + "px;--x:" + v.x + ";--y:" + v.y + ";--r:" + v.r +
        ";--mx:" + v.mx + ";--my:" + v.my + ";--mr:" + v.mr + ";--z:" + (8 - i);
      el.dataset.tip = v.diff ? "COMPARE · different image" : "COMPARE · candidate";
      var a = v.diff ? ASSETS[9] : ASSETS[0];
      el.innerHTML = figHTML(a, 160).replace("</figure>",
        '<span class="badge ' + (v.diff ? 'uni">UNIQUE' : 'dup">DUP') + "</span>" +
        '<span class="meta"><span>' + v.lab + "</span></span></figure>");
      stage.appendChild(el);
      return el;
    });
    var cmpA = $("#cmpA"), cmpB = $("#cmpB"), cmpBlbl = $("#cmpBlbl");
    var distEl = $("#ddDist"), verdictEl = $("#ddVerdict"), logEl = $("#cmpLog");
    renderBits(cmpA, KEEP_BITS);

    var timers = [];
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }

    function setStatus(t) { if (status) status.textContent = t; }
    function logRow(v, d) {
      if (!logEl) return;
      var row = document.createElement("div");
      row.className = d <= 6 ? "ok" : "no";
      row.innerHTML = "<span>vs " + v.lab.split(" · ")[0] + "</span><span>d=" +
        String(d).padStart(2, "0") + " → " + (d <= 6 ? "MATCH" : "DIFFERENT") + "</span>";
      logEl.appendChild(row);
    }

    function compare(idx, done) {
      var v = DD[idx], el = vEls[idx];
      var d = v.bits.reduce(function (s, b, i) { return s + (b !== KEEP_BITS[i] ? 1 : 0); }, 0);
      setStatus("comparing 1600×1067 ↔ " + v.lab.split(" · ")[0]);
      el.classList.add("comparing");
      if (cmpBlbl) cmpBlbl.textContent = "B · " + v.lab.split(" · ")[0];
      renderBits(cmpB, v.bits, "dim");
      if (verdictEl) { verdictEl.className = "hash-verdict"; verdictEl.textContent = "computing…"; }
      if (distEl) distEl.textContent = "00";
      var cells = $$("i", cmpB);
      var seen = 0, j = 0;
      (function sweep() {
        var batch = 0;
        while (j < 64 && batch < 3) {
          var cell = cells[j];
          cell.classList.remove("dim");
          if (v.bits[j] !== KEEP_BITS[j]) {
            cell.classList.add("dif");
            seen++;
            if (distEl) distEl.textContent = String(seen).padStart(2, "0");
          }
          j++; batch++;
        }
        if (j < 64) requestAnimationFrame(sweep);
        else {
          var match = d <= 6;
          if (verdictEl) {
            verdictEl.className = "hash-verdict pop" + (match ? "" : " no");
            verdictEl.innerHTML = "d = " + String(d).padStart(2, "0") + (match ? " ≤ 6 → <b>MATCH</b>" : " &gt; 6 → <b>DIFFERENT</b>");
          }
          logRow(v, d);
          el.classList.remove("comparing");
          el.classList.add("resolved", match ? "merged" : "away");
          later(done, 420);
        }
      })();
    }

    function run() {
      clearTimers();
      // reset
      vEls.forEach(function (el) { el.classList.remove("comparing", "resolved", "merged", "away", "ghost"); });
      keeper.classList.remove("authority");
      stage.classList.remove("resolved");
      if (logEl) logEl.innerHTML = "";
      if (REDUCED) { finishInstant(); return; }
      setStatus("computing fingerprints…");
      // fingerprint pass: a quick scan flash across each card
      vEls.concat([keeper]).forEach(function (el, i) {
        later(function () {
          el.classList.add("hashing");
          later(function () { el.classList.remove("hashing"); }, 380);
        }, i * 140);
      });
      var order = [0, 1, 2, 3, 4], k = 0;
      later(function next() {
        if (k >= order.length) { resolve(); return; }
        compare(order[k++], function () { later(next, 260); });
      }, 1100);
    }
    function resolve() {
      stage.classList.add("resolved");
      keeper.classList.add("authority");
      vEls.forEach(function (el, i) { if (!DD[i].diff) el.classList.add("ghost"); });
      setStatus("group resolved — 5 files → 1 image · 1 unique kept apart");
    }
    function finishInstant() {
      vEls.forEach(function (el, i) {
        el.classList.add("resolved", DD[i].diff ? "away" : "merged");
        if (!DD[i].diff) el.classList.add("ghost");
        var d = DD[i].bits.reduce(function (s, b, j) { return s + (b !== KEEP_BITS[j] ? 1 : 0); }, 0);
        logRow(DD[i], d);
      });
      stage.classList.add("resolved");
      keeper.classList.add("authority");
      renderBits(cmpB, DD[4].bits);
      var dd = DD[4].bits.reduce(function (s, b, i) { return s + (b !== KEEP_BITS[i] ? 1 : 0); }, 0);
      $$("i", cmpB).forEach(function (c, i) { if (DD[4].bits[i] !== KEEP_BITS[i]) c.classList.add("dif"); });
      if (cmpBlbl) cmpBlbl.textContent = "B · texture-linen";
      if (distEl) distEl.textContent = String(dd);
      if (verdictEl) { verdictEl.className = "hash-verdict no"; verdictEl.innerHTML = "d = " + dd + " &gt; 6 → <b>DIFFERENT</b>"; }
      setStatus("group resolved — 5 files → 1 image · 1 unique kept apart");
    }
    var btn = $("#ddRun");
    if (btn) btn.addEventListener("click", run);
    var ran = false;
    observe(stage, function () {
      if (ran) return; ran = true;
      setTimeout(run, REDUCED ? 0 : 600);
    }, 0.45);
  }

  /* ---------------------------------------------------------------
     STAGE 04 — ZIP: the survivors arrive from upstream, then fly
     into the archive one by one. Ends on a mechanical READY.
     --------------------------------------------------------------- */
  function initZip() {
    var fieldEl = $("#zipField"), man = $("#manifest"), zipbox = $("#zipbox");
    if (!fieldEl || !man) return;
    var thumbs = [];
    SURVIVORS.forEach(function (a, i) {
      var el = document.createElement("div");
      el.className = "zt";
      var r = rng(900 + i * 7);
      el.style.left = (4 + (i % 4) * 24 + r() * 4) + "%";
      el.style.top = (6 + Math.floor(i / 4) * 44 + r() * 8) + "%";
      el.style.setProperty("--ad", (i * 90) + "ms");
      el.dataset.tip = "PACKAGE · " + a.name + "." + a.ext.toLowerCase();
      el.innerHTML = figHTML(a, 120);
      fieldEl.appendChild(el);
      thumbs.push(el);
      var row = document.createElement("div");
      row.innerHTML = "<span>" + String(i + 1).padStart(3, "0") + "_" + a.name + "." + a.ext.toLowerCase() +
        "</span><span>" + a.kb + ' KB <span class="ok">✓</span></span>';
      man.appendChild(row);
    });
    var moreRow = document.createElement("div");
    moreRow.className = "more";
    moreRow.innerHTML = "<span>+ 65 more files</span><span>…</span>";
    man.appendChild(moreRow);
    var rows = $$("div", man);
    var prog = $("#zipProg"), foot = $("#zipFoot");
    var playing = false;
    function play() {
      if (playing) return; playing = true;
      zipbox.classList.remove("ready");
      thumbs.forEach(function (t) { t.classList.remove("gone"); });
      rows.forEach(function (r) { r.classList.remove("in"); });
      if (foot) foot.textContent = "receiving…";
      if (REDUCED) { finish(); return; }
      thumbs.forEach(function (t, i) {
        setTimeout(function () {
          var from = t.getBoundingClientRect();
          var clone = document.createElement("div");
          clone.className = "flier";
          clone.style.cssText = "left:" + from.left + "px;top:" + from.top + "px;width:" + from.width + "px";
          clone.innerHTML = t.innerHTML;
          document.body.appendChild(clone);
          t.classList.add("gone");
          var tg = zipbox.getBoundingClientRect();
          var dx = tg.left + tg.width * 0.5 - from.left - from.width / 2;
          var dy = tg.top + 40 - from.top;
          clone.animate([
            { transform: "translate(0,0) scale(1)", opacity: 1 },
            { transform: "translate(" + dx * 0.5 + "px," + (dy * 0.5 - 60) + "px) scale(.7)", opacity: 1, offset: 0.55 },
            { transform: "translate(" + dx + "px," + dy + "px) scale(.15)", opacity: 0 }
          ], { duration: 640, easing: "cubic-bezier(.3,.6,.4,1)" }).onfinish = function () {
            clone.remove();
            rows[i].classList.add("in");
            // the archive visibly receives the file
            zipbox.animate([
              { transform: "translateY(0)" }, { transform: "translateY(2px)" }, { transform: "translateY(0)" }
            ], { duration: 130, easing: "ease-out" });
            if (prog) prog.style.setProperty("--zp", ((i + 1) / thumbs.length).toFixed(2));
            if (i === thumbs.length - 1) finish();
          };
        }, i * 210);
      });
    }
    function finish() {
      rows.forEach(function (r) { r.classList.add("in"); });
      if (prog) prog.style.setProperty("--zp", 1);
      if (foot) foot.innerHTML = '<b class="rdy">READY.</b> images_example_com.zip · 73 files';
      zipbox.classList.add("ready");
      if (!REDUCED) zipbox.animate([
        { transform: "translateY(0)" }, { transform: "translateY(3px)" }, { transform: "translateY(0)" }
      ], { duration: 220, easing: "cubic-bezier(.3,.7,.4,1)" });
      setTimeout(function () { playing = false; }, 400);
    }
    var replay = $("#zipReplay");
    if (replay) replay.addEventListener("click", function () {
      if (playing) return;
      if (prog) prog.style.setProperty("--zp", 0);
      fieldEl.classList.add("arrived");
      play();
    });
    // continuity: survivors arrive from upstream first, then get packaged
    observe(fieldEl, function () {
      fieldEl.classList.add("arrived");
      setTimeout(play, REDUCED ? 0 : 1250);
    }, 0.45);
  }

  /* ---------------------------------------------------------------
     LOCAL — the session ledger proves the whole pipeline stayed
     inside the device; the finished zip lands next to DISK.
     --------------------------------------------------------------- */
  function initLocal() {
    var ledger = $("#ledger");
    if (!ledger) return;
    var done = false;
    observe(ledger, function () {
      if (done) return; done = true;
      $$("[data-count]", ledger).forEach(function (el, i) {
        setTimeout(function () { tick(el, 0, +el.dataset.count, 700); }, i * 160);
      });
      setTimeout(function () {
        var chip = $("#zipchip");
        if (chip) chip.classList.add("in");
      }, REDUCED ? 0 : 900);
    }, 0.4);
  }

  /* ---------------------------------------------------------------
     GATES — funnel counters at section boundaries
     --------------------------------------------------------------- */
  function initGates() {
    $$(".gate").forEach(function (g) {
      var done = false;
      observe(g, function () {
        if (done) return; done = true;
        g.classList.add("in");
        $$("[data-count]", g).forEach(function (el) { tick(el, 0, +el.dataset.count, 800); });
      }, 0.6);
    });
  }

  /* ---------------------------------------------------------------
     FINAL — the funnel resolves, then hands over control
     --------------------------------------------------------------- */
  function initFinal() {
    var f = $("#endFunnel");
    if (!f) return;
    var parts = $$("span, em", f);
    var done = false;
    observe(f, function () {
      if (done) return; done = true;
      parts.forEach(function (el, i) {
        setTimeout(function () { el.classList.add("in"); }, REDUCED ? 0 : i * 260);
      });
    }, 0.6);
  }

  /* ---------------------------------------------------------------
     Contextual cursor tip (desktop, fine pointers): the interface
     tells you what the machine would do with each object.
     --------------------------------------------------------------- */
  function initCursor() {
    if (!FINE || REDUCED) return;
    var tip = document.createElement("div");
    tip.className = "curtip";
    tip.setAttribute("aria-hidden", "true");
    document.body.appendChild(tip);
    var raf = null, x = 0, y = 0, on = false;
    document.addEventListener("pointermove", function (e) {
      x = e.clientX; y = e.clientY;
      if (on && !raf) raf = requestAnimationFrame(function () {
        raf = null;
        tip.style.transform = "translate(" + (x + 16) + "px," + (y + 18) + "px)";
      });
    }, { passive: true });
    document.addEventListener("pointerover", function (e) {
      var t = e.target && e.target.closest && e.target.closest("[data-tip]");
      if (t) {
        tip.textContent = t.dataset.tip;
        tip.style.transform = "translate(" + (x + 16) + "px," + (y + 18) + "px)";
        tip.classList.add("on");
        on = true;
      } else if (on) {
        tip.classList.remove("on");
        on = false;
      }
    }, { passive: true });
  }

  /* ---------------------------------------------------------------
     Shared machinery: scroll bus, reveals, status readout, rail
     --------------------------------------------------------------- */
  var scrollFns = [];
  function onScroll(fn) { scrollFns.push(fn); }
  (function () {
    var raf = null;
    window.addEventListener("scroll", function () {
      if (!raf) raf = requestAnimationFrame(function () {
        raf = null;
        for (var i = 0; i < scrollFns.length; i++) scrollFns[i]();
      });
    }, { passive: true });
  })();

  function observe(el, cb, thr) {
    if (!("IntersectionObserver" in window)) { cb(); return; }
    var o = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { cb(); o.disconnect(); } });
    }, { threshold: thr || 0.3 });
    o.observe(el);
  }

  function initReveals() {
    var els = $$(".rv");
    if (!("IntersectionObserver" in window) || REDUCED) {
      els.forEach(function (e) { e.classList.add("in"); });
      return;
    }
    // low threshold: tall elements (the playground is >1 viewport) can never
    // reach a high intersection ratio, so reveal as soon as they meaningfully enter
    var o = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); o.unobserve(e.target); }
      });
    }, { threshold: 0.05, rootMargin: "0px 0px -60px 0px" });
    els.forEach(function (e) { o.observe(e); });
  }

  function initStatus() {
    var bar = $("#topbar");
    var status = $("#statusText");
    var rail = $$(".rail a");
    var sections = $$("[data-status]");
    onScroll(function () { bar.classList.toggle("scrolled", window.scrollY > 30); });
    bar.classList.toggle("scrolled", window.scrollY > 30);
    if (!("IntersectionObserver" in window)) return;
    var o = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        if (status && el.dataset.status) status.textContent = el.dataset.status;
        document.body.classList.toggle("in-light", el.classList.contains("light"));
        var id = el.id;
        rail.forEach(function (a) {
          a.classList.toggle("act", a.getAttribute("href") === "#" + id);
        });
      });
    }, { rootMargin: "-45% 0px -45% 0px" });
    sections.forEach(function (s) { o.observe(s); });
  }

  /* boot */
  document.addEventListener("DOMContentLoaded", function () {
    buildHero();
    initScan();
    initPlayground();
    initDedupe();
    initZip();
    initLocal();
    initGates();
    initFinal();
    initCursor();
    initReveals();
    initStatus();
  });
})();
