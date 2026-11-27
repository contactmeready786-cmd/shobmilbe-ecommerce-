// 🧮 ইলেকট্রনিক্স টুলস in the browser (lib/views/tools.tsx draws the fields): every sum is done here, as the visitor
// types — nothing goes to the server. The sums themselves are in ./toolmath.ts (tested in tests/tools.test.ts).
import { h, Fragment, paint } from '../jsx.js';
import { $, $all, bn } from '../dom.js';
import { track } from './track.js';
import { bandsValue, valueBands, parseOhms, smdValue, capValue, e12Around, fmtOhms, fmtCap, parseCap, num } from './toolmath.js';
import type { Band } from './toolmath.js';

type TransistorRow = { name: string; kind: string; pins: string; hfe: number; icMa: number };

export function startTools(): void {
  for (const box of $all('[data-calc]')) {
    const kind = box.getAttribute('data-calc') || '';
    const start = CALCS[kind];
    if (!start) continue;
    start(box);
    // one "used" note per page view, for the shop's reports
    let noted = false;
    box.addEventListener('input', () => { if (!noted) { noted = true; track('tool_use', { label: kind }); } }, { once: false });
  }
}

const val = (box: Element, name: string) => ($<HTMLInputElement>(`[name="${name}"]`, box)?.value || '');
const outOf = (box: Element, sel = '[data-calc-out]') => $(sel, box);
const show = (el: Element | null, ...rows: (Node | string | null)[]) => paint(el, ...rows);
const line = (label: string, value: string, big = false) => <p className={big ? 'calc-big' : ''}><span className="muted">{label}</span>{' '}<b>{bn(value)}</b></p>;
const warn = (text: string) => <p className="warn small">{text}</p>;
const shopLink = (q: string, text: string) => <p className="small"><a href={`/products?q=${encodeURIComponent(q)}`}>🛒 {text}</a></p>;
const n2 = (x: number, d = 3) => String(Math.round(x * 10 ** d) / 10 ** d);
const fmtA = (amps: number) => (amps >= 1 ? `${n2(amps)} A` : `${n2(amps * 1000, 2)} mA`);
const fmtW = (w: number) => (w >= 1 ? `${n2(w)} W` : `${n2(w * 1000, 1)} mW`);
const watts = (w: number) => (w <= 0.125 ? '⅛W বা ¼W' : w <= 0.25 ? '½W' : w <= 0.5 ? '১W' : w <= 1 ? '২W' : `${bn(Math.ceil(w * 2))}W বা তার বেশি (সিমেন্ট রেজিস্টর)`);

const CALCS: Record<string, (box: HTMLElement) => void> = {
  // 🌈 colour bands ⇄ value
  'resistor-color': (box) => {
    const bands = JSON.parse(box.getAttribute('data-bands') || '[]') as Band[];
    const selects = $('[data-rc-selects]', box);
    const visual = $('[data-rc-visual]', box);
    const current: Record<number, string[]> = { 4: ['yellow', 'violet', 'red', 'gold'], 5: ['brown', 'black', 'black', 'red', 'brown'], 6: ['brown', 'black', 'black', 'red', 'brown', 'brown'] };
    const count = () => Number($<HTMLInputElement>('input[name="bands"]:checked', box)?.value || 4);
    const role = (n: number, i: number) => {
      const digits = n === 4 ? 2 : 3;
      if (i < digits) return { label: `${bn(i + 1)}ম অঙ্ক`, ok: (b: Band) => b.digit !== null && !(i === 0 && b.digit === 0) };
      if (i === digits) return { label: 'গুণক', ok: (b: Band) => b.mult !== null };
      if (i === digits + 1) return { label: 'টলারেন্স', ok: (b: Band) => b.tol !== null };
      return { label: 'টেম্পকো', ok: (b: Band) => b.ppm !== null };
    };
    const draw = () => {
      const n = count();
      const keys = current[n];
      const r = bandsValue(keys);
      paint(visual, <span className="rc-lead"></span>, <span className="rc-body">{keys.map((k, i) => <span className={`rc-band${i === keys.length - 1 && n > 3 ? ' rc-last' : ''}`} style={`background:${bands.find((b) => b.key === k)?.hex || '#000'}`}></span>)}</span>, <span className="rc-lead"></span>);
      show(outOf(box), r
        ? <>{line('মান:', fmtOhms(r.ohms), true)}{line('টলারেন্স:', r.tol === null ? '—' : `±${r.tol}%`)}{r.ppm !== null ? line('তাপমাত্রা সহগ:', `${r.ppm} ppm/°C`) : null}{line('আসল মান থাকবে:', r.tol === null ? '—' : `${fmtOhms(r.ohms * (1 - r.tol / 100))} থেকে ${fmtOhms(r.ohms * (1 + r.tol / 100))}`)}{shopLink(fmtOhms(r.ohms), `${fmtOhms(r.ohms)} রেজিস্টর দোকানে খুঁজুন`)}</>
        : warn('এই রংগুলো দিয়ে কোনো রেজিস্টর হয় না — প্রথম দাগ কালো/সোনালি/রুপালি হলে উল্টো দিক থেকে পড়ুন।'));
    };
    const build = () => {
      const n = count();
      paint(selects, ...current[n].map((k, i) => {
        const r = role(n, i);
        const sel = <select aria-label={r.label}>{bands.filter(r.ok).map((b) => <option value={b.key} selected={b.key === k}>{b.bn}</option>)}</select> as HTMLSelectElement;
        sel.addEventListener('change', () => { current[n][i] = sel.value; draw(); });
        return <label className="rc-pick"><span className="small muted">{r.label}</span>{sel}</label>;
      }));
      draw();
    };
    for (const r of $all<HTMLInputElement>('input[name="bands"]', box)) r.addEventListener('change', build);
    build();
    // value → colours
    const rev = $('[data-rc-rev]', box);
    $<HTMLInputElement>('[name="value"]', box)?.addEventListener('input', () => {
      const o = parseOhms(val(box, 'value'));
      if (!(o > 0)) { show(rev, val(box, 'value') ? warn('মানটা এভাবে লিখুন: 220, 4.7k, 4k7, 1M') : null); return; }
      const chip = (k: string) => { const b = bands.find((x) => x.key === k)!; return <span className="rc-tag"><span className="rc-chip" style={`background:${b.hex}`}></span>{b.bn}</span>; };
      const four = valueBands(o, 4); const five = valueBands(o, 5);
      const e = e12Around(o);
      show(rev,
        four ? <p><span className="muted">৪ দাগ (±৫%):</span> {four.map(chip)} {chip('gold')}</p> : null,
        five ? <p><span className="muted">৫ দাগ (±১%):</span> {five.map(chip)} {chip('brown')}</p> : null,
        e.up !== o ? <p className="small muted">এটা স্ট্যান্ডার্ড (E12) মান নয়; কাছের মান: {bn(fmtOhms(e.down))} বা {bn(fmtOhms(e.up))}</p> : null);
    });
  },

  // 🔢 SMD code → value
  smd: (box) => {
    const go = () => {
      const code = val(box, 'code');
      const r = smdValue(code);
      show(outOf(box), !code ? null : r ? <>{line('মান:', fmtOhms(r.ohms), true)}{line('কোডের ধরন:', r.kind)}{r.ohms > 0 ? shopLink(fmtOhms(r.ohms), `${fmtOhms(r.ohms)} রেজিস্টর খুঁজুন`) : null}</> : warn('কোডটা চেনা যায়নি — যেমন 103, 4R7, 1002 বা 01C লিখুন।'));
    };
    box.addEventListener('input', go);
  },

  // 🔋 capacitor code → value, and unit converter
  cap: (box) => {
    box.addEventListener('input', () => {
      const code = val(box, 'code');
      const r = capValue(code);
      show(outOf(box), !code ? null : r ? <>{line('মান:', fmtCap(r.pf), true)}{line('একই মান:', `${n2(r.pf)} pF = ${n2(r.pf / 1e3)} nF = ${n2(r.pf / 1e6, 6)} µF`)}{r.tol ? line('টলারেন্স:', r.tol) : null}</> : warn('কোডটা চেনা যায়নি — যেমন 104, 473J, 2A104K, 4R7 লিখুন।'));
      const v = val(box, 'value');
      const pf = parseCap(v);
      show($('[data-cap-conv]', box), !v ? null : pf > 0 ? line('=', `${n2(pf)} pF = ${n2(pf / 1e3)} nF = ${n2(pf / 1e6, 6)} µF`) : warn('একক সহ লিখুন: 100n, 0.1u, 4700p'));
    });
  },

  // ⚡ Ohm's law: any two of V, I, R, P
  ohm: (box) => {
    const go = () => {
      let V = num(val(box, 'v')); let I = num(val(box, 'i')) / 1000; let R = parseOhms(val(box, 'r')); let P = num(val(box, 'p'));
      const have = [V, I, R, P].filter((x) => isFinite(x) && x > 0).length;
      if (have < 2) { show(outOf(box), have ? <p className="muted small">আরেকটা ঘর পূরণ করুন।</p> : null); return; }
      const ok = (x: number) => isFinite(x) && x > 0;
      if (ok(V) && ok(I)) { R = V / I; P = V * I; }
      else if (ok(V) && ok(R)) { I = V / R; P = V * I; }
      else if (ok(I) && ok(R)) { V = I * R; P = V * I; }
      else if (ok(P) && ok(V)) { I = P / V; R = V / I; }
      else if (ok(P) && ok(I)) { V = P / I; R = V / I; }
      else if (ok(P) && ok(R)) { I = Math.sqrt(P / R); V = I * R; }
      show(outOf(box), line('ভোল্টেজ:', `${n2(V)} V`, true), line('কারেন্ট:', fmtA(I)), line('রেজিস্ট্যান্স:', fmtOhms(R)), line('পাওয়ার:', fmtW(P)), <p className="small muted">রেজিস্টর নিন অন্তত {watts(P)} রেটিংয়ের।</p>);
    };
    box.addEventListener('input', go);
    $('[data-calc-clear]', box)?.addEventListener('click', () => { for (const i of $all<HTMLInputElement>('input', box)) i.value = ''; go(); });
  },

  // 💡 LED resistor
  led: (box) => {
    const color = $<HTMLSelectElement>('[name="color"]', box);
    color?.addEventListener('change', () => { const vf = $<HTMLInputElement>('[name="vf"]', box); if (vf) vf.value = color.value; go(); });
    const go = () => {
      const vs = num(val(box, 'vs')); const vf = num(val(box, 'vf')); const ma = num(val(box, 'ma')); const n = Math.max(1, Math.round(num(val(box, 'n')) || 1));
      if (!(vs > 0 && vf > 0 && ma > 0)) { show(outOf(box), null); return; }
      const drop = vs - vf * n;
      if (drop <= 0) { show(outOf(box), warn(`${bn(n)}টা LED-এ মোট ${bn(n2(vf * n))}V লাগে — সাপ্লাই (${bn(vs)}V) এর চেয়ে বেশি হতে হবে। LED কমান বা সাপ্লাই বাড়ান।`)); return; }
      const R = drop / (ma / 1000);
      const up = e12Around(R).up;
      const P = (ma / 1000) ** 2 * up;
      show(outOf(box), line('হিসাবে রেজিস্টর:', fmtOhms(R), true), line('দোকানের কাছের মান (নিরাপদ):', fmtOhms(up)), line('এই মানে কারেন্ট:', fmtA(drop / up)), line('রেজিস্টরের পাওয়ার:', fmtW(P)), <p className="small muted">রেজিস্টর নিন {watts(P)}। {n > 1 ? 'সিরিজের সব LED একই রঙের হলে ভালো।' : ''}</p>, shopLink(fmtOhms(up), `${fmtOhms(up)} রেজিস্টর খুঁজুন`));
    };
    box.addEventListener('input', go);
    go();
  },

  // ➗ voltage divider
  divider: (box) => {
    const go = () => {
      const vin = num(val(box, 'vin')); const r1 = parseOhms(val(box, 'r1')); const r2 = parseOhms(val(box, 'r2'));
      show(outOf(box), vin > 0 && r1 > 0 && r2 > 0 ? <>{line('Vout:', `${n2(vin * r2 / (r1 + r2))} V`, true)}{line('ডিভাইডারে কারেন্ট:', fmtA(vin / (r1 + r2)))}</> : null);
      const want = num(val(box, 'want'));
      const rev = $('[data-div-rev]', box);
      if (!(want > 0)) { show(rev, null); return; }
      if (!(vin > want)) { show(rev, warn('Vout অবশ্যই Vin-এর চেয়ে কম হতে হবে।')); return; }
      if (!(r2 > 0)) { show(rev, warn('উপরে R2-এর মান দিন।')); return; }
      const R1 = r2 * (vin - want) / want;
      const e = e12Around(R1);
      show(rev, line('দরকারি R1:', fmtOhms(R1), true), line('কাছের স্ট্যান্ডার্ড মান:', `${fmtOhms(e.down)} (Vout ${n2(vin * r2 / (e.down + r2))}V) বা ${fmtOhms(e.up)} (Vout ${n2(vin * r2 / (e.up + r2))}V)`));
    };
    box.addEventListener('input', go);
    go();
  },

  // 🔗 series / parallel
  sp: (box) => {
    const go = () => {
      const isCap = $<HTMLInputElement>('input[name="kind"]:checked', box)?.value === 'c';
      const parts = val(box, 'values').split(/[,،;\n]+/).map((x) => x.trim()).filter(Boolean);
      const vals = parts.map((p) => (isCap ? parseCap(p) : parseOhms(p)));
      if (!vals.length) { show(outOf(box), null); return; }
      if (vals.some((x) => !(x > 0))) { show(outOf(box), warn(isCap ? 'মানগুলো এভাবে লিখুন: 100n, 10u, 22p' : 'মানগুলো এভাবে লিখুন: 1k, 2.2k, 470')); return; }
      const sum = vals.reduce((a, b) => a + b, 0);
      const inv = 1 / vals.reduce((a, b) => a + 1 / b, 0);
      const fmt = isCap ? fmtCap : fmtOhms;
      const series = isCap ? inv : sum; const parallel = isCap ? sum : inv;
      show(outOf(box), line('সিরিজে মোট:', fmt(series), true), line('প্যারালালে মোট:', fmt(parallel), true), <p className="small muted">{bn(vals.length)}টা {isCap ? 'ক্যাপাসিটর' : 'রেজিস্টর'}</p>);
    };
    box.addEventListener('input', go);
    box.addEventListener('change', go);
    go();
  },

  // 🔀 transistor switch: base resistor
  transistor: (box) => {
    const list = JSON.parse(box.getAttribute('data-transistors') || '[]') as TransistorRow[];
    const go = () => {
      const t = list[Number($<HTMLSelectElement>('[name="t"]', box)?.value || 0)];
      const ic = num(val(box, 'ic')) / 1000; const vin = num(val(box, 'vin'));
      if (!t || !(ic > 0 && vin > 0.8)) { show(outOf(box), null); return; }
      const ib = (ic / t.hfe) * 5;
      const rb = (vin - 0.7) / ib;
      const e = e12Around(rb).down;
      const over = ic * 1000 > t.icMa * 0.8;
      const pin = vin <= 5.5 && ib > 0.02;
      show(outOf(box),
        line('দরকারি বেস কারেন্ট:', fmtA(ib)), line('বেস রেজিস্টর (হিসাব):', fmtOhms(rb), true), line('দোকানের কাছের মান (একটু ছোটটা নিন):', fmtOhms(e)),
        <p className="small muted">পিন (লেখা দিক সামনে, বাঁ থেকে): <b>{t.pins}</b> · hFE ধরা হয়েছে {bn(t.hfe)}</p>,
        over ? warn(`এই লোড ${t.name}-এর জন্য বেশি (সর্বোচ্চ ${bn(t.icMa)} mA) — বড় ট্রানজিস্টর (যেমন TIP120) বা মসফেট নিন।`) : null,
        pin ? warn('আরডুইনোর পিন থেকে এত বেস কারেন্ট (২০ mA-এর বেশি) নেওয়া ঠিক না — ডার্লিংটন (TIP120) বা লজিক-লেভেল মসফেট নিন।') : null,
        t.kind.startsWith('PNP') ? <p className="small muted">PNP লোডের প্লাসের দিকে বসে, বেস LOW দিলে চালু হয়।</p> : null,
        shopLink(t.name.split(' ')[0], `${t.name.split(' ')[0]} দোকানে খুঁজুন`));
    };
    box.addEventListener('input', go);
    box.addEventListener('change', go);
    go();
  },

  // ⏱️ 555 timer
  '555': (box) => {
    const go = () => {
      const mono = $<HTMLInputElement>('input[name="mode"]:checked', box)?.value === 'm';
      const r1 = parseOhms(val(box, 'r1')); const r2 = parseOhms(val(box, 'r2')); const c = parseCap(val(box, 'c')) / 1e12;
      const r2box = $<HTMLElement>('[name="r2"]', box)?.closest('label');
      if (r2box) r2box.hidden = mono;
      const t = (s: number) => (s >= 1 ? `${n2(s)} সেকেন্ড` : `${n2(s * 1000, 2)} মিলিসেকেন্ড`);
      if (mono) {
        if (!(r1 > 0 && c > 0)) { show(outOf(box), null); return; }
        show(outOf(box), line('আউটপুট চালু থাকবে:', t(1.1 * r1 * c), true), <p className="small muted">R1 আর C দিয়ে হিসাব (t = 1.1 × R × C)।</p>);
        return;
      }
      if (!(r1 > 0 && r2 > 0 && c > 0)) { show(outOf(box), null); return; }
      const high = 0.693 * (r1 + r2) * c; const low = 0.693 * r2 * c; const f = 1 / (high + low);
      show(outOf(box), line('ফ্রিকোয়েন্সি:', f >= 1000 ? `${n2(f / 1000)} kHz` : `${n2(f)} Hz`, true), line('চালু থাকার সময়:', t(high)), line('বন্ধ থাকার সময়:', t(low)), line('ডিউটি সাইকেল:', `${n2(high / (high + low) * 100, 1)}%`), r1 < 1000 ? warn('R1 অন্তত ১kΩ রাখুন।') : null);
    };
    box.addEventListener('input', go);
    box.addEventListener('change', go);
    go();
  },

  // 🔋 battery life
  battery: (box) => {
    const go = () => {
      const mah = num(val(box, 'mah')); const cells = Math.max(1, Math.round(num(val(box, 'cells')) || 1)); const ma = num(val(box, 'ma')); const eff = num(val(box, 'eff')) || 80;
      if (!(mah > 0 && ma > 0)) { show(outOf(box), null); return; }
      const hours = (mah * cells) / ma * Math.min(100, Math.max(10, eff)) / 100;
      show(outOf(box), line('প্রায় চলবে:', hours >= 48 ? `${n2(hours / 24, 1)} দিন` : hours >= 1 ? `${n2(hours, 1)} ঘণ্টা` : `${n2(hours * 60, 0)} মিনিট`, true), line('মোট ক্ষমতা:', `${mah * cells} mAh`));
    };
    box.addEventListener('input', go);
    go();
  },
};
