// Server-rendered charts (SVG / HTML). No external libraries, so they load instantly.
import { Val, RawHtml, attrValue, styleOf, jsxList } from '../react/html';
import { esc, bn, money } from '../util';
import type { Body, Loose } from '../types';

const PALETTE = ['#0866D6', '#F5A524', '#12804A', '#7C4DDB', '#E0513B', '#0FA3B1', '#B36B00', '#5B6B85', '#D63384', '#2E7D32'];
const short = (n?: Loose) => {
  const v = Math.abs(Number(n) || 0);
  const s = v >= 1e7 ? (v / 1e7).toFixed(1) + ' কো' : v >= 1e5 ? (v / 1e5).toFixed(1) + ' লা' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'হা' : String(Math.round(v));
  return (n < 0 ? '-' : '') + bn(s.replace('.0', ''));
};
function niceMax(v?: Loose) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
function dayLabel(d?: Loose) {
  const s = String(d instanceof Date ? d.toISOString() : d).slice(0, 10);
  return bn(s.slice(8, 10)) + '/' + bn(s.slice(5, 7));
}

// Columns (bars) with an optional line on top. series: [{label, bar, line}]
function combo(series?: Loose, { barName = '', lineName = '', barMoney = false, lineMoney = true, height = 260 }: Body = {}) {
  if (!series.length) return <p className="muted">কোনো ডাটা নেই।</p>;
  const W = 760; const H = height; const L = 54; const R = 54; const T = 16; const B = 30;
  const iw = W - L - R; const ih = H - T - B;
  const bmax = niceMax(Math.max(...series.map((s?: Loose) => s.bar || 0)));
  const lmax = niceMax(Math.max(...series.map((s?: Loose) => s.line || 0)));
  const n = series.length;
  const step = iw / n;
  const bw = Math.max(2, Math.min(28, step * 0.62));
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const y = T + ih - (ih * i) / 4;
    grid += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="ch-grid"/>`;
    grid += `<text x="${L - 6}" y="${y + 4}" class="ch-ax" text-anchor="end">${esc(barMoney ? '৳' + short((bmax * i) / 4) : short((bmax * i) / 4))}</text>`;
    if (lineName) grid += `<text x="${W - R + 6}" y="${y + 4}" class="ch-ax ch-ax-r">${esc(lineMoney ? '৳' + short((lmax * i) / 4) : short((lmax * i) / 4))}</text>`;
  }
  let bars = '';
  let pts = '';
  let labels = '';
  const every = Math.ceil(n / 12);
  series.forEach((s?: Loose, i?: Loose) => {
    const cx = L + step * i + step / 2;
    const bh = (ih * (s.bar || 0)) / bmax;
    const tip = `${s.label}: ${barName} ${barMoney ? money(s.bar) : bn(s.bar || 0)}${lineName ? `, ${lineName} ${lineMoney ? money(s.line) : bn(s.line || 0)}` : ''}`;
    bars += `<rect x="${cx - bw / 2}" y="${T + ih - bh}" width="${bw}" height="${Math.max(0, bh)}" rx="3" class="ch-bar"><title>${esc(tip)}</title></rect>`;
    if (lineName) pts += `${pts ? 'L' : 'M'}${cx.toFixed(1)},${(T + ih - (ih * Math.max(0, s.line || 0)) / lmax).toFixed(1)} `;
    if (i % every === 0) labels += `<text x="${cx}" y="${H - 8}" class="ch-ax" text-anchor="middle">${esc(s.label)}</text>`;
  });
  const dots = lineName ? series.map((s?: Loose, i?: Loose) => {
    const cx = L + step * i + step / 2;
    return `<circle cx="${cx}" cy="${T + ih - (ih * Math.max(0, s.line || 0)) / lmax}" r="${n > 40 ? 1.5 : 3}" class="ch-dot"><title>${esc(`${s.label}: ${lineName} ${lineMoney ? money(s.line) : bn(s.line || 0)}`)}</title></circle>`;
  }).join('') : '';
  return <figure className="chart"><svg viewBox={`0 0 ${attrValue(W)} ${attrValue(H)}`} role="img" aria-label={`${attrValue(barName)} ${attrValue(lineName)}`}><RawHtml html={grid + bars} />{(lineName ? <RawHtml html={`<path d="${pts}" class="ch-line"/>${dots}`} /> : null)}<RawHtml html={labels} /></svg><figcaption className="legend">{(barName ? <span><i className="sw" style={styleOf("background:var(--blue)")}></i><Val v={barName} /></span> : null)}{(lineName ? <span><i className="sw sw-line"></i><Val v={lineName} /></span> : null)}</figcaption></figure>;
}

// Horizontal bars: rows [{label, value, sub}]
function hbars(rows?: Loose, { isMoney = false, color = 0 }: Body = {}) {
  if (!rows.length) return <p className="muted">কোনো ডাটা নেই।</p>;
  const max = Math.max(...rows.map((r?: Loose) => Number(r.value) || 0), 1);
  return <ul className="hbars">{jsxList(rows.map((r?: Loose, i?: Loose) => <li><span className="hb-label" title={attrValue(r.label)}><Val v={r.label} /></span>{' '}<span className="hb-track"><span className="hb-fill" style={styleOf(`width:${Math.max(2, (100 * (Number(r.value) || 0)) / max).toFixed(1)}%;background:${attrValue(PALETTE[(color === -1 ? i : color) % PALETTE.length])}`)}></span></span>{' '}<span className="hb-val">{(isMoney ? money(r.value) : bn(r.value))}{(r.sub ? <>{' '}<small><Val v={r.sub} /></small></> : null)}</span></li>))}</ul>;
}

// Donut: rows [{label, value}]
function donut(rows?: Loose, { center = '', centerSub = '' }: Body = {}) {
  const total = rows.reduce((s?: Loose, r?: Loose) => s + (Number(r.value) || 0), 0);
  if (!total) return <p className="muted">কোনো ডাটা নেই।</p>;
  const R = 70; const C = 2 * Math.PI * R;
  let off = 0;
  const segs = rows.map((r?: Loose, i?: Loose) => {
    const len = (C * (Number(r.value) || 0)) / total;
    const s = `<circle r="${R}" cx="90" cy="90" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="26"
      stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"><title>${esc(r.label)}: ${bn(r.value)}</title></circle>`;
    off += len;
    return s;
  }).join('');
  return <div className="donut"><svg viewBox="0 0 180 180" width="180" height="180" role="img"><g transform="rotate(-90 90 90)"><RawHtml html={segs} /></g>{' '}<text x="90" y="88" className="dn-c" text-anchor="middle"><Val v={center || bn(total)} /></text>{' '}<text x="90" y="108" className="dn-s" text-anchor="middle"><Val v={centerSub} /></text></svg><ul className="dn-legend">{jsxList(rows.map((r?: Loose, i?: Loose) => <li><i className="sw" style={styleOf(`background:${attrValue(PALETTE[i % PALETTE.length])}`)}></i><Val v={r.label} />{' '}<b>{bn(r.value)}</b>{' '}<small>({bn(Math.round((100 * r.value) / total))}%)</small></li>))}</ul></div>;
}

// 24-hour heat strip.
function hours(rows?: Loose, unit: Loose = 'টি অর্ডার') {
  const by = new Array(24).fill(0);
  rows.forEach((r?: Loose) => { by[r.h] = r.n; });
  const max = Math.max(...by, 1);
  return <div className="hours">{jsxList(by.map((n, h) => <span style={styleOf(`--a:${(0.08 + (0.92 * n) / max).toFixed(2)}`)} title={`${bn(h)}টা: ${bn(n)}${attrValue(unit)}`}><i>{bn(h)}</i></span>))}</div>;
}

export { combo, hbars, donut, hours, dayLabel, short, PALETTE };
