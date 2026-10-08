/* Owner login lock: passkeys (fingerprint / Windows Hello / phone QR) and the camera face check.
   Used on two admin pages: the second-check page after the owner's password (/admin/verify)
   and the setup page (/admin/security/login). */
(function () {
  'use strict';
  var BASE = '/admin/security/login';
  function $(s, r) { return (r || document).querySelector(s); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ------------------------------------------------------------ helpers
  function toB64u(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64u(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, status: r.status, data: data || {} }; });
    });
  }
  function show(el, on) { if (el) el.hidden = !on; }
  function say(el, text, bad) { if (!el) return; el.textContent = text || ''; el.hidden = !text; el.classList.toggle('is-bad', !!bad); }

  // ------------------------------------------------------------ passkeys
  function pkSupported() { return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create); }
  function pkError(e, creating) {
    var n = e && e.name;
    if (n === 'NotAllowedError' || n === 'AbortError') return 'বাতিল করা হয়েছে বা সময় শেষ হয়ে গেছে। আবার চাপুন।';
    if (n === 'InvalidStateError' && creating) return 'এই ডিভাইসে আগেই পাসকি যোগ করা আছে।';
    if (n === 'SecurityError') return 'এই ঠিকানায় পাসকি চলছে না (HTTPS দরকার)।';
    if (n === 'NotSupportedError') return 'এই ডিভাইস/ব্রাউজারে পাসকি চলে না। Chrome, Edge বা Safari-র নতুন সংস্করণ ব্যবহার করুন।';
    return (e && e.message) || 'কিছু একটা ভুল হয়েছে, আবার চেষ্টা করুন।';
  }
  function pkCreate(name) {
    if (!pkSupported()) return Promise.reject(new Error('এই ব্রাউজারে পাসকি চলে না। Chrome, Edge বা Safari-র নতুন সংস্করণ ব্যবহার করুন।'));
    return postJSON(BASE + '/passkey/options').then(function (r) {
      if (!r.ok) throw new Error(r.data.error || 'শুরু করা যায়নি');
      var o = r.data;
      o.challenge = fromB64u(o.challenge);
      o.user.id = fromB64u(o.user.id);
      o.excludeCredentials = (o.excludeCredentials || []).map(function (c) { return { type: c.type, id: fromB64u(c.id) }; });
      return navigator.credentials.create({ publicKey: o }).catch(function (e) { throw new Error(pkError(e, true)); });
    }).then(function (cred) {
      var resp = cred.response;
      return postJSON(BASE + '/passkey/add', {
        id: cred.id, type: cred.type, name: name,
        transports: resp.getTransports ? resp.getTransports() : [],
        response: { clientDataJSON: toB64u(resp.clientDataJSON), attestationObject: toB64u(resp.attestationObject) },
      });
    }).then(function (r) {
      if (!r.ok) throw new Error(r.data.error || 'যোগ করা যায়নি');
      return r.data;
    });
  }
  function pkVerify() {
    if (!pkSupported()) return Promise.reject(new Error('এই ব্রাউজারে পাসকি চলে না। Chrome, Edge বা Safari-র নতুন সংস্করণ ব্যবহার করুন।'));
    return postJSON('/admin/verify/passkey/options').then(function (r) {
      if (!r.ok) { var err = new Error(r.data.error || 'শুরু করা যায়নি'); err.to = r.data.to; throw err; }
      var o = r.data;
      o.challenge = fromB64u(o.challenge);
      o.allowCredentials = (o.allowCredentials || []).map(function (c) { var x = { type: c.type, id: fromB64u(c.id) }; if (c.transports) x.transports = c.transports; return x; });
      return navigator.credentials.get({ publicKey: o }).catch(function (e) { throw new Error(pkError(e, false)); });
    }).then(function (cred) {
      var resp = cred.response;
      return postJSON('/admin/verify/passkey', {
        id: cred.id, type: cred.type,
        response: {
          clientDataJSON: toB64u(resp.clientDataJSON), authenticatorData: toB64u(resp.authenticatorData),
          signature: toB64u(resp.signature), userHandle: resp.userHandle ? toB64u(resp.userHandle) : null,
        },
      });
    });
  }

  // ------------------------------------------------------------ face library (loaded only when needed)
  var MODEL_URL = '/vendor/face-api/model';
  var modelsReady = null;
  function loadFaceLib() {
    if (window.faceapi) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/vendor/face-api/face-api.js';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('মুখ চেনার প্রোগ্রাম লোড হয়নি। ইন্টারনেট দেখে আবার চেষ্টা করুন।')); };
      document.head.appendChild(s);
    });
  }
  function loadModels() {
    if (!modelsReady) {
      modelsReady = loadFaceLib().then(function () {
        // the graphics card (WebGL) is fastest; very old devices fall back to the plain processor
        var tf = window.faceapi.tf;
        return Promise.resolve().then(function () { return tf.setBackend('webgl'); }).catch(function () { return false; })
          .then(function (ok) { return ok ? true : tf.setBackend('cpu'); })
          .then(function () { return tf.ready(); });
      }).then(function () {
        var fa = window.faceapi;
        return Promise.all([
          fa.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          fa.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          fa.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
      }).catch(function (e) { modelsReady = null; throw e; });
    }
    return modelsReady;
  }
  function detOpts(size) { return new window.faceapi.TinyFaceDetectorOptions({ inputSize: size || 320, scoreThreshold: 0.5 }); }

  // ------------------------------------------------------------ camera
  function camError(e) {
    var n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'ক্যামেরার অনুমতি দেওয়া হয়নি। ঠিকানার পাশের 🔒 চিহ্নে চাপ দিয়ে ক্যামেরা "Allow" করুন, তারপর আবার চেষ্টা করুন।';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'কোনো ক্যামেরা পাওয়া যায়নি।';
    if (n === 'NotReadableError') return 'ক্যামেরা অন্য কোনো অ্যাপ ব্যবহার করছে। সেটা বন্ধ করে আবার চেষ্টা করুন।';
    return (e && e.message) || 'ক্যামেরা চালু করা যায়নি।';
  }
  function Cam(root) {
    this.root = root;
    this.video = $('video', root);
    this.ring = $('[data-ll-ring]', root);
    this.idle = $('[data-ll-idle]', root);
    this.sayEl = $('[data-ll-say]', root);
    this.stepsEl = $('[data-ll-steps]', root);
    this.btn = $('[data-ll-face-go]', root);
    this.stream = null;
  }
  Cam.prototype.say = function (t, bad) { say(this.sayEl, t, bad); };
  Cam.prototype.ringState = function (s) { if (this.ring) this.ring.setAttribute('data-state', s || ''); };
  Cam.prototype.start = function () {
    var self = this;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('এই ব্রাউজারে ক্যামেরা চালানো যায় না।'));
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .catch(function (e) { throw new Error(camError(e)); })
      .then(function (stream) {
        self.stream = stream;
        self.video.srcObject = stream;
        show(self.idle, false);
        self.root.classList.add('is-live');
        return self.video.play().catch(function () {});
      }).then(function () {
        // wait until the first real frame
        var t0 = Date.now();
        return (function wait() {
          if (self.video.videoWidth > 0) return Promise.resolve();
          if (Date.now() - t0 > 8000) return Promise.reject(new Error('ক্যামেরা থেকে ছবি আসছে না।'));
          return sleep(100).then(wait);
        })();
      });
  };
  Cam.prototype.stop = function () {
    if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
    this.stream = null;
    this.video.srcObject = null;
    this.root.classList.remove('is-live');
    show(this.idle, true);
    this.ringState('');
  };

  // ------------------------------------------------------------ face geometry
  function d(a, b) { var x = a.x - b.x, y = a.y - b.y; return Math.sqrt(x * x + y * y); }
  function ear(p) { return (d(p[1], p[5]) + d(p[2], p[4])) / (2 * d(p[0], p[3]) || 1); }
  function metrics(det, video) {
    var p = det.landmarks.positions;
    var j0 = p[0], j16 = p[16], nose = p[30];
    var w = j16.x - j0.x || 1;
    return {
      ear: (ear(p.slice(36, 42)) + ear(p.slice(42, 48))) / 2,
      // 0 = looking straight. In the camera's own (not mirrored) picture, the person's LEFT turn moves the nose to the right → positive.
      yaw: ((nose.x - j0.x) / w - 0.5) * 2,
      size: det.detection.box.width / (video.videoWidth || 640),
      box: det.detection.box,
    };
  }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[Math.floor(s.length / 2)] : 0; }
  function pct(a, q) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0; }

  var STEP_TEXT = {
    blink: '👁️ চোখের পলক ফেলুন (ধীরে একবার)',
    left: '⬅️ মাথা আস্তে বাম দিকে ঘোরান',
    right: '➡️ মাথা আস্তে ডান দিকে ঘোরান',
    center: '🙂 এবার সোজা ক্যামেরার দিকে তাকান',
  };
  function drawSteps(cam, steps, at) {
    if (!cam.stepsEl) return;
    var all = ['start'].concat(steps).concat(['center']);
    var names = { start: '🙂 সোজা তাকান', blink: '👁️ পলক', left: '⬅️ বামে', right: '➡️ ডানে', center: '🙂 সোজা তাকান' };
    cam.stepsEl.innerHTML = '';
    all.forEach(function (s, i) {
      var li = document.createElement('li');
      li.textContent = (i < at ? '✅ ' : '') + names[s];
      if (i === at) li.className = 'is-now';
      if (i < at) li.className = 'is-done';
      cam.stepsEl.appendChild(li);
    });
  }

  // The live-person test. Resolves with { descriptors, events, duration }.
  function liveness(cam, steps) {
    var fa = window.faceapi;
    var t0 = Date.now(), lastSeen = Date.now();
    var phase = 0; // 0 = start (look straight), 1..n = steps, n+1 = final look straight
    var yaws = [], baseYaw = 0, ears = [];
    var descriptors = [], events = [];
    var captured = 0, frame = 0;
    var blinkClosedAt = 0, needCenter = false, pauseUntil = 0;
    var LIMIT = 60000;
    drawSteps(cam, steps, 0);
    cam.say(STEP_TEXT.center);

    function grab() {
      return fa.detectSingleFace(cam.video, detOpts()).withFaceLandmarks().withFaceDescriptor().then(function (r) {
        if (r && r.descriptor) { descriptors.push(Array.prototype.slice.call(r.descriptor)); return true; }
        return false;
      });
    }
    function nextPhase() {
      if (phase >= 1 && phase <= steps.length) events.push({ step: steps[phase - 1], t: Date.now() - t0 });
      phase += 1; captured = 0; needCenter = true; blinkClosedAt = 0; ears = ears.slice(-8);
      pauseUntil = Date.now() + 500; // a moment to read the next instruction
      drawSteps(cam, steps, phase);
      cam.say(phase <= steps.length ? STEP_TEXT[steps[phase - 1]] : STEP_TEXT.center);
    }

    return new Promise(function (resolve, reject) {
      function tick() {
        if (!cam.stream) return reject(new Error('ক্যামেরা বন্ধ হয়ে গেছে।'));
        if (Date.now() - t0 > LIMIT) return reject(new Error('সময় শেষ হয়ে গেছে। আবার চেষ্টা করুন।'));
        fa.detectSingleFace(cam.video, detOpts()).withFaceLandmarks().then(function (det) {
          var now = Date.now();
          if (!det) {
            cam.ringState('warn');
            if (now - lastSeen > 2500) return reject(new Error('মুখ ফ্রেমের বাইরে চলে গেছে। আবার শুরু করুন।'));
            cam.say('মুখ গোল দাগের ভেতরে আনুন', true);
            return;
          }
          lastSeen = now;
          if (now < pauseUntil) return;
          var m = metrics(det, cam.video);
          if (m.size < 0.16) { cam.ringState('warn'); cam.say('ক্যামেরার একটু কাছে আসুন', true); return; }
          cam.ringState('ok');
          frame += 1;
          var rel = m.yaw - baseYaw;

          if (phase === 0) {
            cam.say(STEP_TEXT.center);
            if (Math.abs(m.yaw) > 0.25) return;
            yaws.push(m.yaw); ears.push(m.ear);
            if (yaws.length >= 6) baseYaw = median(yaws.slice(-6));
            if (yaws.length >= 6 && captured < 2 && frame % 2 === 0) return grab().then(function (ok) { if (ok) captured += 1; });
            if (captured >= 2) nextPhase();
            return;
          }
          if (needCenter) {
            if (Math.abs(rel) < 0.14) { needCenter = false; cam.say(phase <= steps.length ? STEP_TEXT[steps[phase - 1]] : STEP_TEXT.center); }
            else { cam.say('🙂 আগে সোজা তাকান'); return; }
          }
          if (phase > steps.length) {
            // final: look straight, two more face prints
            if (Math.abs(rel) > 0.14 || m.ear < pct(ears, 0.8) * 0.8) return;
            if (frame % 2 === 0) return grab().then(function (ok) {
              if (ok) captured += 1;
              if (captured >= 2) { cam.say('✅ হয়ে গেছে, মিলিয়ে দেখা হচ্ছে…'); drawSteps(cam, steps, steps.length + 2); resolve({ descriptors: descriptors, events: events, duration: Date.now() - t0 }); }
            });
            return;
          }
          var step = steps[phase - 1];
          if (step === 'blink') {
            var open = pct(ears, 0.8);
            if (!blinkClosedAt && ears.length >= 4 && m.ear < open * 0.72) blinkClosedAt = now;
            else if (blinkClosedAt && m.ear > open * 0.88) {
              if (now - blinkClosedAt < 1500) return nextPhase();
              blinkClosedAt = 0;
            }
            if (!blinkClosedAt) { ears.push(m.ear); if (ears.length > 30) ears.shift(); }
            // one face print while the eyes are open and looking straight
            if (captured < 1 && Math.abs(rel) < 0.12 && m.ear > open * 0.9 && frame % 3 === 0) return grab().then(function (ok) { if (ok) captured += 1; });
            return;
          }
          if (step === 'left' && rel > 0.3) return nextPhase();
          if (step === 'right' && rel < -0.3) return nextPhase();
          if ((step === 'left' && rel < -0.3) || (step === 'right' && rel > 0.3)) cam.say('↔️ উল্টো দিকে ঘোরান — ' + STEP_TEXT[step], true);
        }).catch(function () { /* one bad frame: ignore */ }).then(function () {
          if (cam.stream) setTimeout(tick, 15);
        });
      }
      tick();
    });
  }

  // A clear, straight-looking face from the camera for saving as the owner's face.
  function captureFace(cam) {
    var fa = window.faceapi;
    var good = 0, prints = [], t0 = Date.now();
    cam.say('🙂 সোজা ক্যামেরার দিকে তাকান, নড়বেন না…');
    return new Promise(function (resolve, reject) {
      function tick() {
        if (!cam.stream) return reject(new Error('ক্যামেরা বন্ধ হয়ে গেছে।'));
        if (Date.now() - t0 > 30000) return reject(new Error('মুখ পরিষ্কার দেখা যায়নি। ভালো আলোতে বসে আবার চেষ্টা করুন।'));
        fa.detectSingleFace(cam.video, detOpts(416)).withFaceLandmarks().withFaceDescriptor().then(function (r) {
          if (!r) { cam.ringState('warn'); cam.say('মুখ গোল দাগের ভেতরে আনুন', true); good = 0; return; }
          var m = metrics(r, cam.video);
          if (m.size < 0.2) { cam.ringState('warn'); cam.say('ক্যামেরার একটু কাছে আসুন', true); good = 0; return; }
          if (Math.abs(m.yaw) > 0.22) { cam.ringState('warn'); cam.say('🙂 মাথা সোজা রাখুন', true); good = 0; return; }
          cam.ringState('ok'); cam.say('🙂 ঠিক আছে, নড়বেন না…');
          good += 1;
          prints.push(Array.prototype.slice.call(r.descriptor));
          if (good >= 3) {
            var avg = prints.slice(-3).reduce(function (a, p) { return a.map(function (v, i) { return v + p[i] / 3; }); }, new Array(128).fill(0));
            resolve({ descriptor: avg, photo: snapshot(cam.video, r.detection.box) });
          }
        }).catch(function () {}).then(function () { if (cam.stream && good < 3) setTimeout(tick, 120); });
      }
      tick();
    });
  }

  // Crop around the face, at most 480px, as a JPEG data URL.
  function snapshot(src, box) {
    var sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
    var size = Math.max(box.width, box.height) * 1.9;
    var cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    var x = Math.max(0, cx - size / 2), y = Math.max(0, cy - size / 2);
    var w = Math.min(sw - x, size), h = Math.min(sh - y, size);
    var scale = Math.min(1, 480 / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  }

  function faceFromFile(file) {
    var fa = window.faceapi;
    return new Promise(function (resolve, reject) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('শুধু JPG, PNG বা WebP ছবি দিন।'));
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        // big phone photos: scale down first
        var scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        fa.detectAllFaces(c, detOpts(512)).withFaceLandmarks().withFaceDescriptors().then(function (all) {
          if (!all.length) return reject(new Error('ছবিতে কোনো মুখ পাওয়া যায়নি। সামনে থেকে তোলা পরিষ্কার ছবি দিন।'));
          if (all.length > 1) return reject(new Error('ছবিতে একাধিক মুখ আছে। শুধু আপনার একার ছবি দিন।'));
          var r = all[0];
          if (r.detection.box.width < 80) return reject(new Error('ছবিতে মুখটা অনেক ছোট। কাছ থেকে তোলা ছবি দিন।'));
          resolve({ descriptor: Array.prototype.slice.call(r.descriptor), photo: snapshot(c, r.detection.box) });
        }).catch(reject);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('ছবিটি খোলা যায়নি।')); };
      img.src = url;
    });
  }

  // Run the live-person test against the server: options → camera → result.
  function runFaceCheck(cam, optionsUrl, resultUrl) {
    cam.btn.disabled = true;
    cam.say('⏳ মুখ চেনার প্রোগ্রাম লোড হচ্ছে… (প্রথমবার ১০-৩০ সেকেন্ড লাগতে পারে)');
    var nonce;
    return loadModels().then(function () {
      return postJSON(optionsUrl);
    }).then(function (r) {
      if (!r.ok) { var e = new Error(r.data.error || 'শুরু করা যায়নি'); e.to = r.data.to; throw e; }
      nonce = r.data.nonce;
      cam.say('📷 ক্যামেরা চালু হচ্ছে…');
      return cam.start().then(function () { return liveness(cam, r.data.steps); });
    }).then(function (res) {
      cam.stop();
      res.nonce = nonce;
      return postJSON(resultUrl, res);
    }).then(function (r) {
      cam.btn.disabled = false;
      return r;
    }, function (e) {
      cam.stop();
      cam.btn.disabled = false;
      throw e;
    });
  }

  // ============================================================ page: second check after the password
  var verify = $('[data-ll-verify]');
  if (verify) {
    var need = verify.getAttribute('data-need');
    var mobile = verify.getAttribute('data-mobile') === '1';
    var hasPk = verify.getAttribute('data-has-passkey') === '1';
    var hasFace = verify.getAttribute('data-has-face') === '1';
    var pkBox = $('[data-ll-pk]', verify), faceBox = $('[data-ll-face]', verify);
    var msg = $('[data-ll-msg]', verify);
    var sw = $('[data-ll-switch]', verify), swBtn = $('[data-ll-switch-btn]', verify);
    var current = null;

    var showPart = function (which) {
      current = which;
      show(pkBox, which === 'passkey');
      show(faceBox, which === 'face');
      say(msg, '');
      if (need === 'either' && ((which === 'passkey' && hasFace) || (which === 'face' && hasPk))) {
        show(sw, true);
        swBtn.textContent = which === 'passkey' ? '🙂 আঙুলের ছাপ নেই? ক্যামেরায় মুখ দিয়ে যাচাই করুন' : '👆 আঙুলের ছাপ / পাসকি দিয়ে যাচাই করবেন?';
      } else show(sw, false);
    };
    if (swBtn) swBtn.addEventListener('click', function () { showPart(current === 'passkey' ? 'face' : 'passkey'); });

    var finish = function (r) {
      if (r.ok && r.data.done) { say(msg, ''); location.href = r.data.to || '/admin'; return; }
      if (r.ok && r.data.next) { location.reload(); return; }
      say(msg, r.data.error || 'যাচাই হয়নি, আবার চেষ্টা করুন।', true);
      if (r.data.to) setTimeout(function () { location.href = r.data.to; }, 2500);
    };
    var failMsg = function (e) {
      say(msg, e.message || 'কিছু একটা ভুল হয়েছে।', true);
      if (e.to) setTimeout(function () { location.href = e.to; }, 2500);
    };

    var pkBtn = $('[data-ll-pk-go]', verify);
    if (pkBtn) pkBtn.addEventListener('click', function () {
      pkBtn.disabled = true; say(msg, '');
      pkVerify().then(finish, failMsg).then(function () { pkBtn.disabled = false; });
    });
    var camRoot = $('[data-ll-cam]', verify);
    if (camRoot) {
      var cam = new Cam(camRoot);
      cam.btn.addEventListener('click', function () {
        say(msg, '');
        runFaceCheck(cam, '/admin/verify/face/options', '/admin/verify/face').then(function (r) {
          if (!r.ok) { cam.say(''); cam.btn.textContent = '🔁 আবার চেষ্টা করুন'; }
          finish(r);
        }, function (e) { cam.say(''); cam.btn.textContent = '🔁 আবার চেষ্টা করুন'; failMsg(e); });
      });
    }

    if (need === 'passkey') showPart('passkey');
    else if (need === 'face') showPart('face');
    else if (need === 'either') {
      // phone with a fingerprint → fingerprint; computer or no fingerprint → face
      var canPlatform = (hasPk && window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable)
        ? PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(function () { return false; }) : Promise.resolve(false);
      canPlatform.then(function (yes) {
        if (mobile && yes && hasPk) showPart('passkey');
        else if (hasFace) showPart('face');
        else showPart('passkey');
      });
    }
  }

  // ============================================================ page: setup (Admin → লগইন তালা)
  var pkReg = $('[data-ll-pk-register]');
  if (pkReg) {
    var note = $('[data-ll-pk-note]');
    pkReg.addEventListener('click', function () {
      var nameEl = document.querySelector('input[name="pk_name"]');
      pkReg.disabled = true;
      say(note, '👆 ডিভাইসের আঙুলের ছাপ / স্ক্রিন লক দিন…');
      pkCreate(nameEl ? nameEl.value : '').then(function () {
        say(note, '✅ পাসকি যোগ হয়েছে।');
        location.href = BASE + '?msg=added&t=' + Date.now() + '#passkeys';
      }, function (e) { say(note, '❌ ' + e.message, true); pkReg.disabled = false; });
    });
  }

  var faceTools = $('[data-ll-face-add]');
  if (faceTools) {
    var panel = $('[data-ll-face-panel]', faceTools);
    var fnote = $('[data-ll-face-note]', faceTools);
    var fcam = new Cam($('[data-ll-cam]', panel));
    var action = null;
    var saveFace = function (f, source) {
      say(fnote, '⏳ সেভ হচ্ছে…');
      return postJSON(BASE + '/face/add', { photo: f.photo, descriptor: f.descriptor, source: source }).then(function (r) {
        if (!r.ok) throw new Error(r.data.error || 'সেভ হয়নি');
        say(fnote, '✅ মুখের ছবি সেভ হয়েছে।');
        location.href = BASE + '?msg=added&t=' + Date.now() + '#faces';
      });
    };
    var openPanel = function (what, label) {
      action = what;
      show(panel, true);
      fcam.btn.textContent = label;
      fcam.say(''); say(fnote, '');
      if (fcam.stepsEl) fcam.stepsEl.innerHTML = '';
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    var camBtn = $('[data-ll-face-camera]', faceTools);
    if (camBtn) camBtn.addEventListener('click', function () { openPanel('enroll', '📷 ক্যামেরা চালু করে ছবি তুলুন'); });
    var testBtn = $('[data-ll-face-test]', faceTools);
    if (testBtn) testBtn.addEventListener('click', function () { openPanel('test', '🧪 ক্যামেরা চালু করে পরীক্ষা শুরু করুন'); });

    fcam.btn.addEventListener('click', function () {
      say(fnote, '');
      if (action === 'enroll') {
        fcam.btn.disabled = true;
        fcam.say('⏳ মুখ চেনার প্রোগ্রাম লোড হচ্ছে… (প্রথমবার ১০-৩০ সেকেন্ড লাগতে পারে)');
        loadModels().then(function () { return fcam.start(); }).then(function () { return captureFace(fcam); })
          .then(function (f) { fcam.stop(); fcam.say(''); return saveFace(f, 'camera'); })
          .catch(function (e) { fcam.stop(); fcam.say(''); say(fnote, '❌ ' + e.message, true); })
          .then(function () { fcam.btn.disabled = false; });
      } else if (action === 'test') {
        runFaceCheck(fcam, BASE + '/face/test-options', BASE + '/face/test').then(function (r) {
          fcam.say('');
          if (!r.ok) return say(fnote, '❌ ' + (r.data.error || 'পরীক্ষা হয়নি'), true);
          if (r.data.ok) say(fnote, '✅ মুখ মিলেছে! (মিল ' + r.data.score + '%) লগইনের সময়ও এভাবেই কাজ করবে।');
          else say(fnote, '❌ ' + r.data.reason + (r.data.score != null ? ' (মিল ' + r.data.score + '%)' : '') + ' — ভালো আলোতে আবার চেষ্টা করুন, অথবা ক্যামেরা দিয়ে আরেকটা মুখের ছবি যোগ করুন।', true);
        }, function (e) { fcam.say(''); say(fnote, '❌ ' + e.message, true); });
      }
    });

    var file = $('[data-ll-face-file]', faceTools);
    if (file) file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      say(fnote, '⏳ ছবিতে মুখ খোঁজা হচ্ছে… (প্রথমবার ১০-৩০ সেকেন্ড লাগতে পারে)');
      loadModels().then(function () { return faceFromFile(f); }).then(function (face) { return saveFace(face, 'upload'); })
        .catch(function (e) { say(fnote, '❌ ' + e.message, true); });
    });
  }
})();
