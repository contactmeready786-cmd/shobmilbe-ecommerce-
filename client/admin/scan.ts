// সবমিলবে admin — reading barcodes with the phone / laptop camera.
// Uses the browser's own BarcodeDetector where it exists (Android Chrome, Mac Chrome); everywhere else
// (iPhone, Windows) a small built-in Code 128 reader looks at lines across the picture.
// USB / Bluetooth barcode guns need none of this: they type the code into the box and press Enter.

// Code 128 bar/space widths for values 0–106 (same table as lib/services/barcode)
const P = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121',
  '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421',
  '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212',
  '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131',
  '311141', '411131', '211412', '211214', '211232', '2331112'];
const PW = P.map((p) => p.split('').map(Number));

/** which value do these 6 runs look like? (null when nothing is close) */
function match(runs: number[], at: number): number | null {
  let sum = 0;
  for (let k = 0; k < 6; k++) sum += runs[at + k];
  if (!sum) return null;
  const unit = sum / 11;
  let best = -1;
  let bestErr = 1e9;
  for (let v = 0; v < 106; v++) {
    let e = 0;
    for (let k = 0; k < 6; k++) { const d = runs[at + k] / unit - PW[v][k]; e += d * d; }
    if (e < bestErr) { bestErr = e; best = v; }
  }
  return bestErr < 2.2 ? best : null;
}
function isStop(runs: number[], at: number): boolean {
  let sum = 0;
  for (let k = 0; k < 7; k++) sum += runs[at + k];
  const unit = sum / 13;
  let e = 0;
  for (let k = 0; k < 7; k++) { const d = runs[at + k] / unit - PW[106][k]; e += d * d; }
  return e < 2.4;
}
/** runs[] = widths, starting with a bar */
export function decodeRuns(runs: number[]): string | null {
  for (let i = 0; i + 6 * 3 + 7 <= runs.length; i += 2) {
    const start = match(runs, i);
    if (start !== 103 && start !== 104 && start !== 105) continue;
    const vals = [start];
    let set = start === 103 ? 'A' : start === 104 ? 'B' : 'C';
    let j = i + 6;
    let ok = false;
    while (j + 7 <= runs.length) {
      if (isStop(runs, j)) { ok = true; break; }
      const v = match(runs, j);
      if (v === null) break;
      vals.push(v);
      j += 6;
    }
    if (!ok || vals.length < 3) continue;
    const check = vals.pop()!;
    let sum = vals[0];
    for (let n = 1; n < vals.length; n++) sum += vals[n] * n;
    if (sum % 103 !== check) continue;
    let out = '';
    for (let n = 1; n < vals.length; n++) {
      const x = vals[n];
      if (set === 'C') { if (x < 100) out += String(x).padStart(2, '0'); else if (x === 100) set = 'B'; else if (x === 101) set = 'A'; }
      else if (x === 99) set = 'C';
      else if (set === 'B' && x === 101) set = 'A';
      else if (set === 'A' && x === 100) set = 'B';
      else if (x < 96) out += set === 'A' && x >= 64 ? String.fromCharCode(x - 64) : String.fromCharCode(x + 32);
    }
    if (out) return out;
  }
  return null;
}
type Run = { dark: boolean; len: number };
/** one line of grey values → runs of dark / light */
function runsOf(g: number[], th: (i: number) => number): Run[] {
  const runs: Run[] = [];
  let cur = g[0] < th(0);
  let len = 0;
  for (let i = 0; i < g.length; i++) {
    const dark = g[i] < th(i);
    if (dark === cur) len++; else { runs.push({ dark: cur, len }); cur = dark; len = 1; }
  }
  runs.push({ dark: cur, len });
  return runs;
}
/** runs → text (tries both directions) */
function tryRuns(runs: Run[]): string | null {
  const firstBar = runs.findIndex((r) => r.dark);
  if (firstBar < 0) return null;
  const t = decodeRuns(runs.slice(firstBar).map((r) => r.len));
  if (t) return t;
  const rev = runs.slice().reverse();
  const fb = rev.findIndex((r) => r.dark);
  return fb < 0 ? null : decodeRuns(rev.slice(fb).map((r) => r.len));
}
/** one line of grey values → text (global and local thresholds, both directions) */
export function decodeLine(g: number[]): string | null {
  let min = 255;
  let max = 0;
  for (const v of g) { if (v < min) min = v; if (v > max) max = v; }
  if (max - min < 50) return null;
  const mid = (min + max) / 2;
  const t = tryRuns(runsOf(g, () => mid));
  if (t) return t;
  // local average (copes with shadows and blur)
  const W = 9;
  const pre = [0];
  for (let i = 0; i < g.length; i++) pre.push(pre[i] + g[i]);
  const local = (k: number) => { const a = Math.max(0, k - W); const b = Math.min(g.length, k + W + 1); return (pre[b] - pre[a]) / (b - a) - 2; };
  return tryRuns(runsOf(g, local));
}
export function decodeImage(ctx: CanvasRenderingContext2D, w: number, h: number): string | null {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (const row of [0.5, 0.42, 0.58, 0.35, 0.65, 0.28, 0.72]) {
    const y = Math.floor(h * row);
    const line = new Array<number>(w);
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; line[x] = data[o] * 0.3 + data[o + 1] * 0.59 + data[o + 2] * 0.11; }
    const t = decodeLine(line);
    if (t) return t;
  }
  return null;
}

// ---------------------------------------------------------------- camera
type Detector = { detect(src: HTMLVideoElement): Promise<{ rawValue?: string }[]> };
type DetectorClass = { new(o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> };
async function makeDetector(): Promise<Detector | null> {
  const BD = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (!BD) return null;
  try {
    const f = await BD.getSupportedFormats();
    const want = ['code_128', 'ean_13', 'ean_8', 'upc_a', 'code_39', 'qr_code'].filter((x) => f.includes(x));
    return want.length ? new BD({ formats: want }) : null;
  } catch { return null; }
}

/** Starts the camera in `video`; every code read goes to onCode. Returns stop(). */
export function startCamera(video: HTMLVideoElement, onCode: (code: string) => void, onError?: (msg: string) => void): () => void {
  let stream: MediaStream | null = null;
  let stopped = false;
  let detector: Detector | null = null;
  const canvas = document.createElement('canvas');
  const cx = canvas.getContext('2d', { willReadFrequently: true })!;
  let last = '';
  let lastAt = 0;
  const found = (t: string) => {
    const now = Date.now();
    if (t === last && now - lastAt < 2500) return;
    last = t;
    lastAt = now;
    onCode(t);
  };
  const tick = async (): Promise<void> => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      if (detector) {
        try { const list = await detector.detect(video); if (list[0]?.rawValue) found(list[0].rawValue); } catch { /* next frame */ }
        setTimeout(tick, 120);
        return;
      }
      const w = Math.min(960, video.videoWidth);
      const hh = Math.round(video.videoHeight * (w / video.videoWidth));
      canvas.width = w;
      canvas.height = hh;
      cx.drawImage(video, 0, 0, w, hh);
      const t = decodeImage(cx, w, hh);
      if (t) found(t);
    }
    setTimeout(tick, 110);
  };
  (async () => {
    try {
      detector = await makeDetector();
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (stopped) { for (const x of s.getTracks()) x.stop(); return; }
      stream = s;
      video.srcObject = s;
      video.setAttribute('playsinline', '');
      video.muted = true;
      await video.play();
      void tick();
    } catch (e) {
      const n = (e as DOMException)?.name;
      onError?.(n === 'NotAllowedError' ? 'ক্যামেরার অনুমতি দেওয়া হয়নি। ঠিকানার পাশের 🔒 চিহ্নে চাপ দিয়ে Camera "Allow" করুন।' : n === 'NotFoundError' ? 'কোনো ক্যামেরা পাওয়া যায়নি।' : 'ক্যামেরা চালু করা যায়নি।');
    }
  })();
  return () => { stopped = true; for (const x of stream?.getTracks() || []) x.stop(); video.srcObject = null; };
}

// little sounds: ok / wrong
let ac: AudioContext | null = null;
export function beep(ok: boolean): void {
  try {
    ac = ac || new AudioContext();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = ok ? 1250 : 220;
    o.type = ok ? 'sine' : 'square';
    g.gain.value = 0.12;
    o.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + (ok ? 0.12 : 0.35));
  } catch { /* no sound */ }
  navigator.vibrate?.(ok ? 60 : [120, 60, 120]);
}
