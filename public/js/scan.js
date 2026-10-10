// সবমিলবে admin — reading barcodes with the phone / laptop camera.
// Uses the browser's own BarcodeDetector where it exists (Android Chrome, Mac Chrome); everywhere else
// (iPhone, Windows) a small built-in Code 128 reader looks at lines across the picture.
// USB / Bluetooth barcode guns need none of this: they type the code into the box and press Enter.
(function () {
  'use strict';
  // Code 128 bar/space widths for values 0–106 (same table as lib/services/barcode.js)
  var P = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
    '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121',
    '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421',
    '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212',
    '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131',
    '311141', '411131', '211412', '211214', '211232', '2331112'];
  var PW = P.map(function (p) { return p.split('').map(Number); });

  // which value do these 6 runs look like? (null when nothing is close)
  function match(runs, at) {
    var sum = 0, k;
    for (k = 0; k < 6; k++) sum += runs[at + k];
    if (!sum) return null;
    var unit = sum / 11, best = -1, bestErr = 1e9;
    for (var v = 0; v < 106; v++) {
      var e = 0;
      for (k = 0; k < 6; k++) { var d = runs[at + k] / unit - PW[v][k]; e += d * d; }
      if (e < bestErr) { bestErr = e; best = v; }
    }
    return bestErr < 2.2 ? best : null;
  }
  function isStop(runs, at) {
    var sum = 0, k;
    for (k = 0; k < 7; k++) sum += runs[at + k];
    var unit = sum / 13, e = 0, S = PW[106];
    for (k = 0; k < 7; k++) { var d = runs[at + k] / unit - S[k]; e += d * d; }
    return e < 2.4;
  }
  // runs[] = widths, starting with a bar
  function decodeRuns(runs) {
    for (var i = 0; i + 6 * 3 + 7 <= runs.length; i += 2) {
      var start = match(runs, i);
      if (start !== 103 && start !== 104 && start !== 105) continue;
      var vals = [start], set = start === 103 ? 'A' : start === 104 ? 'B' : 'C', j = i + 6, ok = false;
      while (j + 7 <= runs.length) {
        if (isStop(runs, j)) { ok = true; break; }
        var v = match(runs, j);
        if (v === null) break;
        vals.push(v); j += 6;
      }
      if (!ok || vals.length < 3) continue;
      var check = vals.pop(), sum = vals[0];
      for (var n = 1; n < vals.length; n++) sum += vals[n] * n;
      if (sum % 103 !== check) continue;
      var out = '';
      for (n = 1; n < vals.length; n++) {
        var x = vals[n];
        if (set === 'C') { if (x < 100) out += (x < 10 ? '0' : '') + x; else if (x === 100) set = 'B'; else if (x === 101) set = 'A'; }
        else if (x === 99) set = 'C';
        else if (set === 'B' && x === 101) set = 'A';
        else if (set === 'A' && x === 100) set = 'B';
        else if (x < 96) out += set === 'A' && x >= 64 ? String.fromCharCode(x - 64) : String.fromCharCode(x + 32);
      }
      if (out) return out;
    }
    return null;
  }
  // one line of grey values → runs → text (tries both directions)
  function runsOf(g, th) {
    var runs = [], cur = g[0] < th(0), len = 0;
    for (var i = 0; i < g.length; i++) {
      var dark = g[i] < th(i);
      if (dark === cur) len++; else { runs.push({ dark: cur, len: len }); cur = dark; len = 1; }
    }
    runs.push({ dark: cur, len: len });
    return runs;
  }
  function tryRuns(runs) {
    var firstBar = runs.findIndex(function (r) { return r.dark; });
    if (firstBar < 0) return null;
    var t = decodeRuns(runs.slice(firstBar).map(function (r) { return r.len; }));
    if (t) return t;
    var rev = runs.slice().reverse(), fb = rev.findIndex(function (r) { return r.dark; });
    return fb < 0 ? null : decodeRuns(rev.slice(fb).map(function (r) { return r.len; }));
  }
  // one line of grey values → runs → text (global and local thresholds, both directions)
  function decodeLine(g) {
    var min = 255, max = 0, i;
    for (i = 0; i < g.length; i++) { if (g[i] < min) min = g[i]; if (g[i] > max) max = g[i]; }
    if (max - min < 50) return null;
    var mid = (min + max) / 2;
    var t = tryRuns(runsOf(g, function () { return mid; }));
    if (t) return t;
    // local average (copes with shadows and blur)
    var W = 9, pre = [0];
    for (i = 0; i < g.length; i++) pre.push(pre[i] + g[i]);
    var local = function (k) { var a = Math.max(0, k - W), b = Math.min(g.length, k + W + 1); return (pre[b] - pre[a]) / (b - a) - 2; };
    return tryRuns(runsOf(g, local));
  }
  function decodeImage(ctx, w, h) {
    var data = ctx.getImageData(0, 0, w, h).data;
    var rows = [0.5, 0.42, 0.58, 0.35, 0.65, 0.28, 0.72];
    for (var r = 0; r < rows.length; r++) {
      var y = Math.floor(h * rows[r]), line = new Array(w);
      for (var x = 0; x < w; x++) { var o = (y * w + x) * 4; line[x] = data[o] * 0.3 + data[o + 1] * 0.59 + data[o + 2] * 0.11; }
      var t = decodeLine(line);
      if (t) return t;
    }
    return null;
  }

  // ---------------------------------------------------------------- camera
  var detector = null;
  function makeDetector() {
    if (!('BarcodeDetector' in window)) return Promise.resolve(null);
    return window.BarcodeDetector.getSupportedFormats().then(function (f) {
      var want = ['code_128', 'ean_13', 'ean_8', 'upc_a', 'code_39', 'qr_code'].filter(function (x) { return f.indexOf(x) !== -1; });
      return want.length ? new window.BarcodeDetector({ formats: want }) : null;
    }).catch(function () { return null; });
  }
  // start(video, onCode) → stop()
  function start(video, onCode, onError) {
    var stream = null, stopped = false, canvas = document.createElement('canvas'), cx = canvas.getContext('2d', { willReadFrequently: true });
    var last = '', lastAt = 0;
    var found = function (t) {
      var now = Date.now();
      if (t === last && now - lastAt < 2500) return;
      last = t; lastAt = now; onCode(t);
    };
    var tick = function () {
      if (stopped) return;
      if (video.readyState >= 2 && video.videoWidth) {
        if (detector) {
          detector.detect(video).then(function (list) { if (list && list[0] && list[0].rawValue) found(list[0].rawValue); }).catch(function () {}).then(function () { setTimeout(tick, 120); });
          return;
        }
        var w = Math.min(960, video.videoWidth), h = Math.round(video.videoHeight * (w / video.videoWidth));
        canvas.width = w; canvas.height = h;
        cx.drawImage(video, 0, 0, w, h);
        var t = decodeImage(cx, w, h);
        if (t) found(t);
      }
      setTimeout(tick, 110);
    };
    makeDetector().then(function (d) {
      detector = d;
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    }).then(function (s) {
      if (stopped) { s.getTracks().forEach(function (x) { x.stop(); }); return; }
      stream = s; video.srcObject = s; video.setAttribute('playsinline', ''); video.muted = true;
      return video.play();
    }).then(function () { tick(); }).catch(function (e) {
      var n = e && e.name;
      if (onError) onError(n === 'NotAllowedError' ? 'ক্যামেরার অনুমতি দেওয়া হয়নি। ঠিকানার পাশের 🔒 চিহ্নে চাপ দিয়ে Camera "Allow" করুন।' : n === 'NotFoundError' ? 'কোনো ক্যামেরা পাওয়া যায়নি।' : 'ক্যামেরা চালু করা যায়নি।');
    });
    return function stop() { stopped = true; if (stream) stream.getTracks().forEach(function (x) { x.stop(); }); video.srcObject = null; };
  }

  // little sounds: ok / wrong
  var ac = null;
  function beep(ok) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      var o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = ok ? 1250 : 220; o.type = ok ? 'sine' : 'square';
      g.gain.value = 0.12; o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + (ok ? 0.12 : 0.35));
    } catch (_) { /* no sound */ }
    if (navigator.vibrate) navigator.vibrate(ok ? 60 : [120, 60, 120]);
  }

  window.SMScan = { start: start, decodeImage: decodeImage, decodeLine: decodeLine, decodeRuns: decodeRuns, beep: beep };
})();
