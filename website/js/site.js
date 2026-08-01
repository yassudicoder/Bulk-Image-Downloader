/* Bulk Image Downloader — site engine.
   Vanilla JS, no dependencies (same rule as the extension itself).
   Everything animates with transform/opacity; scroll work is rAF-throttled. */
(function () {
  "use strict";

  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
     HERO — scanline discovers a field of images.
     Tiles are positioned on a loose grid, avoiding the copy block.
     --------------------------------------------------------------- */
  var HERO_TILES = [
    // [x%, y%, w px, kind, seed, ext, dims, depth]
    [4, 8, 130, "photo", 11, "JPG", "1600×900", 2],
    [21, 5, 96, "texture", 23, "PNG", "800×800", 1],
    [38, 9, 118, "product", 37, "WEBP", "1200×1200", 3],
    [56, 4, 88, "portrait", 41, "JPG", "640×960", 1],
    [70, 10, 140, "photo", 53, "JPG", "2400×1350", 3],
    [88, 6, 92, "chart", 67, "SVG", "900×600", 2],
    [82, 30, 120, "product", 71, "PNG", "1000×1000", 2],
    [92, 52, 96, "texture", 83, "WEBP", "600×600", 1],
    [80, 72, 128, "photo", 97, "JPG", "1920×1080", 3],
    [63, 84, 100, "portrait", 101, "JPG", "800×1200", 2],
    [40, 88, 112, "product", 113, "PNG", "1400×930", 1],
    [18, 84, 124, "photo", 127, "JPG", "1600×1067", 3],
    [3, 62, 96, "chart", 131, "GIF", "480×480", 1],
    [2, 34, 110, "texture", 139, "PNG", "1024×768", 2]
  ];
  function buildHero() {
    var field = $("#heroField");
    if (!field) return;
    var mobile = window.innerWidth < 760;
    HERO_TILES.forEach(function (t, i) {
      // small screens: only bold tiles in the top band, clear of the copy and CTA
      if (mobile && (t[7] < 2 || t[1] > 12)) return;
      var ar = /×/.test(t[6]) ? t[6].split("×") : [4, 3];
      var w = +ar[0], h = +ar[1];
      var el = document.createElement("div");
      el.className = "tile";
      el.style.left = t[0] + "%";
      el.style.top = t[1] + "%";
      el.style.width = (mobile ? t[2] * 0.58 : t[2]) + "px";
      el.style.setProperty("--td", (t[1] / 100 * 1.55).toFixed(2) + "s"); // reveal when scanline passes
      el.style.setProperty("--o", t[7] === 3 ? 1 : t[7] === 2 ? 0.85 : 0.6);
      el.dataset.depth = t[7];
      el.innerHTML = "<figure>" + art(t[4], t[3], 160, Math.round(160 * h / w)) +
        '<span class="tag"><span>IMG_' + String(t[4]).padStart(4, "0") + "</span><span>" + t[6] + " " + t[5] + "</span></span></figure>";
      field.appendChild(el);
    });

    var hero = $("#hero");
    var counter = $("#heroCount");
    function finish() { hero.classList.add("done", "reveal"); if (counter) counter.textContent = "247"; }
    if (REDUCED) { finish(); return; }
    // kick off scan shortly after load; copy reveals mid-sweep so nothing blocks
    setTimeout(function () {
      hero.classList.add("scanning");
      $$(".tile", field).forEach(function (el) { el.classList.add("found"); });
      tick(counter, 0, 247, 1650);
      setTimeout(function () { hero.classList.add("reveal"); }, 620);
      setTimeout(function () { hero.classList.add("done"); }, 1800);
    }, 350);

    // pointer parallax (desktop, fine pointers only)
    if (window.matchMedia("(pointer:fine)").matches) {
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

  function tick(el, from, to, ms) {
    if (!el) return;
    if (REDUCED) { el.textContent = String(to); return; }
    var t0 = performance.now();
    (function step(t) {
      var p = Math.min(1, (t - t0) / ms);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(from + (to - from) * eased));
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ---------------------------------------------------------------
     STAGE 01 — layer explosion driven by scroll progress
     --------------------------------------------------------------- */
  var LAYER_COUNTS = [132, 41, 38, 29, 7]; // img / srcset / css bg / lazy / shadow = 247
  function initScan() {
    var sec = $("#scan");
    var stack = $("#stack");
    if (!sec || !stack) return;
    // scatter "found asset" blobs on each layer
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
    var readC = $("#scanCount");
    var lastN = -1;
    function update() {
      var r = sec.getBoundingClientRect();
      var total = r.height - window.innerHeight;
      var p = Math.max(0, Math.min(1, -r.top / total));
      stack.style.setProperty("--sep", (p * 68).toFixed(1) + "px");
      // light layers up one by one as separation grows
      var lit = Math.floor(p * (layers.length + 0.6));
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
     STAGE 02 — the filter playground (a working miniature of
     results/filters.js: minWidth, file type, only-from-this-page)
     --------------------------------------------------------------- */
  var KINDS = ["photo", "product", "texture", "portrait", "chart"];
  var DATA = (function () {
    var doms = ["example.com", "example.com", "images.example.com", "cdn.shoplet.io", "ads.thirdparty.net"];
    var exts = ["JPG", "JPG", "JPG", "PNG", "PNG", "WEBP", "GIF", "SVG"];
    var r = rng(2026), out = [], i;
    var widths = [96, 240, 320, 480, 640, 800, 800, 960, 1200, 1200, 1400, 1600, 1600, 2000, 2400];
    for (i = 0; i < 24; i++) {
      var w = widths[Math.floor(r() * widths.length)];
      var ratio = [0.66, 0.75, 1, 1.33, 1.5][Math.floor(r() * 5)];
      out.push({
        id: i, seed: 500 + i * 13,
        kind: KINDS[i % KINDS.length],
        w: w, h: Math.round(w * ratio),
        ext: exts[Math.floor(r() * exts.length)],
        dom: doms[Math.floor(r() * doms.length)]
      });
    }
    return out;
  })();
  // mirrors filters.js baseDomain(): sub-domains of the page count as the page
  function samePage(dom) { return /(^|\.)example\.com$/.test(dom); }

  function initPlayground() {
    var grid = $("#pgrid");
    if (!grid) return;
    DATA.forEach(function (d) {
      var el = document.createElement("div");
      el.className = "pcard";
      el.dataset.id = d.id;
      el.innerHTML = "<figure>" + art(d.seed, d.kind, 140, Math.round(140 * d.h / d.w)) + "</figure>" +
        '<div class="meta"><span>' + d.w + "×" + d.h + '</span><span class="ext">' + d.ext + "</span></div>" +
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
        var d = DATA[+c.dataset.id];
        var ok = d.w >= state.minW &&
          (!state.type || d.ext === state.type) &&
          (!state.page || samePage(d.dom));
        var was = !c.classList.contains("out");
        c.classList.toggle("out", !ok);
        if (ok) { shown++; if (!was && animate && !REDUCED) c.classList.add("enter"); }
      });
      if (empty) empty.style.display = shown ? "none" : "block";
      if (countEl) countEl.innerHTML = "<b>" + shown + "</b> of " + DATA.length + " shown";
      if (animate && !REDUCED) {
        // FLIP surviving cards into their new slots
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
     STAGE 03 — dedupe: five variants collapse into a stack
     --------------------------------------------------------------- */
  function initDedupe() {
    var stage = $("#ddStage");
    if (!stage) return;
    var VARS = [
      // [w px, scatter x/y/rot, merged x/y/rot, label, keep?]
      [190, "6%", "10%", "-5deg", "50%", "30%", "0deg", "1600×1067 · 412 KB", true],
      [150, "58%", "6%", "4deg", "66%", "24%", "6deg", "1200×800 · 240 KB", false],
      [120, "70%", "52%", "-7deg", "34%", "52%", "-8deg", "800×533 · 96 KB", false],
      [120, "30%", "58%", "6deg", "67%", "54%", "7deg", "800×533 · 61 KB · q60", false],
      [90, "10%", "62%", "3deg", "32%", "26%", "-6deg", "400×267 · 28 KB", false]
    ];
    VARS.forEach(function (v, i) {
      var el = document.createElement("div");
      el.className = "variant" + (v[8] ? "" : " dupv");
      el.style.cssText = "--vw:" + v[0] + "px;--x:" + v[1] + ";--y:" + v[2] + ";--r:" + v[3] +
        ";--mx:" + v[4] + ";--my:" + v[5] + ";--mr:" + v[6] + ";--z:" + (v[8] ? 9 : 8 - i);
      el.innerHTML = "<figure>" + art(777, "photo", 160, 107) +
        '<span class="badge ' + (v[8] ? "keep\">KEEP" : "dup\">DUP") + "</span>" +
        '<span class="meta"><span>' + v[7] + "</span></span></figure>";
      stage.appendChild(el);
    });
    var btn = $("#ddRun");
    var ran = false;
    function run() {
      stage.classList.toggle("merged");
      if (btn) btn.textContent = stage.classList.contains("merged") ? "SCATTER" : "RUN DEDUPE";
    }
    if (btn) btn.addEventListener("click", run);
    observe(stage, function () {
      if (ran) return; ran = true;
      setTimeout(function () { if (!stage.classList.contains("merged")) run(); }, REDUCED ? 0 : 700);
    }, 0.5);
  }

  /* build the two 64-bit hash comparisons (static, honest bit patterns) */
  function initHashes() {
    function bits(el, hex, diffOf) {
      if (!el) return null;
      var out = [], i, b;
      for (i = 0; i < 64; i++) {
        b = (parseInt(hex[Math.floor(i / 4)], 16) >> (3 - i % 4)) & 1;
        out.push(b);
      }
      el.innerHTML = out.map(function (v, ix) {
        var dif = diffOf && diffOf[ix] !== v;
        return "<i class='" + (v ? "b1" : "") + (dif ? " dif" : "") + "'></i>";
      }).join("");
      return out;
    }
    var a1 = bits($("#hashA1"), "c3a5e1708f4b2d96");
    bits($("#hashA2"), "c3a5e1728f4b2d94", a1); // 3 bits apart → duplicate
    var b1 = bits($("#hashB1"), "c3a5e1708f4b2d96");
    bits($("#hashB2"), "1e5a903fc0b47269", b1); // far apart → different
  }

  /* ---------------------------------------------------------------
     STAGE 04 — zip assembly: thumbs fly into the archive manifest
     --------------------------------------------------------------- */
  var ZIPFILES = [
    ["001_hero-banner.jpg", "412 KB"], ["002_product-front.png", "240 KB"],
    ["003_product-side.png", "236 KB"], ["004_detail-macro.jpg", "188 KB"],
    ["005_lifestyle-01.jpg", "342 KB"], ["006_lifestyle-02.jpg", "305 KB"],
    ["007_swatch-oak.webp", "44 KB"], ["008_size-chart.svg", "12 KB"]
  ];
  function initZip() {
    var fieldEl = $("#zipField"), man = $("#manifest"), zipbox = $("#zipbox");
    if (!fieldEl || !man) return;
    var thumbs = [];
    ZIPFILES.forEach(function (f, i) {
      var el = document.createElement("div");
      el.className = "zt";
      var r = rng(900 + i * 7);
      el.style.left = (4 + (i % 4) * 24 + r() * 4) + "%";
      el.style.top = (6 + Math.floor(i / 4) * 44 + r() * 8) + "%";
      el.innerHTML = "<figure>" + art(880 + i * 31, KINDS[i % KINDS.length], 120, 84) + "</figure>";
      fieldEl.appendChild(el);
      thumbs.push(el);
      var row = document.createElement("div");
      row.innerHTML = "<span>" + f[0] + "</span><span>" + f[1] + ' <span class="ok">✓</span></span>';
      man.appendChild(row);
    });
    var rows = $$("div", man);
    var prog = $("#zipProg"), foot = $("#zipFoot");
    var playing = false;
    function play() {
      if (playing) return; playing = true;
      thumbs.forEach(function (t) { t.classList.remove("gone"); });
      rows.forEach(function (r) { r.classList.remove("in"); });
      if (foot) foot.innerHTML = "compressing…";
      if (REDUCED) { finish(); return; }
      var target = zipbox.getBoundingClientRect();
      thumbs.forEach(function (t, i) {
        setTimeout(function () {
          var from = t.getBoundingClientRect();
          var clone = document.createElement("div");
          clone.className = "flier";
          clone.style.cssText = "left:" + from.left + "px;top:" + from.top + "px;width:" + from.width + "px";
          clone.innerHTML = t.innerHTML;
          document.body.appendChild(clone);
          t.classList.add("gone");
          var tg = zipbox.getBoundingClientRect(); // re-read (page may scroll)
          var dx = tg.left + tg.width * 0.5 - from.left - from.width / 2;
          var dy = tg.top + 40 - from.top;
          clone.animate([
            { transform: "translate(0,0) scale(1)", opacity: 1 },
            { transform: "translate(" + dx * 0.5 + "px," + (dy * 0.5 - 60) + "px) scale(.7)", opacity: 1, offset: 0.55 },
            { transform: "translate(" + dx + "px," + dy + "px) scale(.15)", opacity: 0 }
          ], { duration: 640, easing: "cubic-bezier(.3,.6,.4,1)" }).onfinish = function () {
            clone.remove();
            rows[i].classList.add("in");
            if (prog) prog.style.setProperty("--zp", ((i + 1) / thumbs.length).toFixed(2));
            if (i === thumbs.length - 1) finish();
          };
        }, i * 210);
      });
    }
    function finish() {
      rows.forEach(function (r) { r.classList.add("in"); });
      if (prog) prog.style.setProperty("--zp", 1);
      if (foot) foot.innerHTML = "<b>images_example.com.zip</b> · 8 files · ready";
      setTimeout(function () { playing = false; }, 400);
    }
    var replay = $("#zipReplay");
    if (replay) replay.addEventListener("click", function () {
      if (prog) prog.style.setProperty("--zp", 0);
      play();
    });
    observe(fieldEl, function () { setTimeout(play, 500); }, 0.45);
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
    initHashes();
    initZip();
    initReveals();
    initStatus();
  });
})();
