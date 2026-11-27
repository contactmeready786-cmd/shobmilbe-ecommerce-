// 🧮 ইলেকট্রনিক্স টুলস — the tool list (/tools) and one tool (/tools/<key>). Data: lib/data/tools.ts.
// The boxes here are the calculator's fields; client/shop/tools.tsx does the sums in the visitor's browser.
import { attrValue, jsxList, styleOf } from '../react/html';
import { BANDS, TRANSISTORS } from '../data/tools';
import type { Tool } from '../data/tools';

const field = (label: string, name: string, attrs: { placeholder?: string; value?: string; step?: string } = {}) => (
  <label className="calc-field"><span>{label}</span><input name={name} inputMode="decimal" autoComplete="off" placeholder={attrs.placeholder} defaultValue={attrs.value} /></label>
);
const out = () => <div className="calc-out" data-calc-out="" role="status" aria-live="polite"></div>;

/** the calculator's fields for one tool */
function calculator(key: string) {
  switch (key) {
    case 'resistor-color-code':
      return (<div className="calc" data-calc="resistor-color" data-bands={attrValue(JSON.stringify(BANDS))}>
        <div className="calc-row" role="radiogroup" aria-label="দাগের সংখ্যা">{jsxList([4, 5, 6].map((n) => <label className="calc-pill"><input type="radio" name="bands" defaultValue={attrValue(n)} defaultChecked={n === 4} />{' '}{n === 4 ? '৪ দাগ' : n === 5 ? '৫ দাগ' : '৬ দাগ'}</label>))}</div>
        <div className="rc-resistor" data-rc-visual="" aria-hidden="true"></div>
        <div className="rc-selects" data-rc-selects=""></div>
        {out()}
        <div className="calc-rev"><h3>🔁 মান থেকে রং</h3>{field('রেজিস্টরের মান', 'value', { placeholder: 'যেমন 4.7k, 220, 1M' })}<div className="calc-out" data-rc-rev="" role="status"></div></div>
      </div>);
    case 'smd-resistor-code':
      return (<div className="calc" data-calc="smd">{field('রেজিস্টরের গায়ের কোড', 'code', { placeholder: 'যেমন 103, 4R7, 1002, 01C' })}{out()}</div>);
    case 'capacitor-code':
      return (<div className="calc" data-calc="cap">{field('ক্যাপাসিটরের কোড', 'code', { placeholder: 'যেমন 104, 473J, 2A104K' })}{out()}
        <div className="calc-rev"><h3>🔁 ইউনিট বদলান</h3>{field('মান (একক সহ)', 'value', { placeholder: 'যেমন 100n, 0.1u, 4700p' })}<div className="calc-out" data-cap-conv="" role="status"></div></div></div>);
    case 'ohms-law':
      return (<div className="calc" data-calc="ohm"><p className="small muted">যেকোনো দুইটা ঘর পূরণ করুন, বাকিগুলো নিজে থেকে আসবে।</p><div className="calc-grid">{field('ভোল্টেজ V (ভোল্ট)', 'v')}{field('কারেন্ট I (mA)', 'i')}{field('রেজিস্ট্যান্স R (Ω)', 'r', { placeholder: 'যেমন 220, 4.7k' })}{field('পাওয়ার P (ওয়াট)', 'p')}</div><button type="button" className="btn btn-ghost btn-sm" data-calc-clear="">সব মুছুন</button>{out()}</div>);
    case 'led-resistor':
      return (<div className="calc" data-calc="led"><div className="calc-grid">{field('সাপ্লাই ভোল্টেজ (V)', 'vs', { value: '5' })}<label className="calc-field"><span>LED-এর রং</span><select name="color" defaultValue="2"><option value="2">লাল (≈২V)</option><option value="2.1">হলুদ / কমলা (≈২.১V)</option><option value="2.2">সবুজ (সাধারণ, ≈২.২V)</option><option value="3">নীল / সাদা / উজ্জ্বল সবুজ (≈৩V)</option></select></label>{field('LED-এর ভোল্টেজ (V)', 'vf', { value: '2' })}{field('কারেন্ট (mA)', 'ma', { value: '20' })}{field('সিরিজে কয়টা LED', 'n', { value: '1' })}</div>{out()}</div>);
    case 'voltage-divider':
      return (<div className="calc" data-calc="divider"><div className="calc-grid">{field('ইনপুট ভোল্টেজ Vin (V)', 'vin', { value: '5' })}{field('R1 (উপরের)', 'r1', { value: '10k' })}{field('R2 (নিচের, GND দিকে)', 'r2', { value: '20k' })}</div>{out()}
        <div className="calc-rev"><h3>🔁 দরকারি Vout থেকে R1</h3><div className="calc-grid">{field('দরকারি Vout (V)', 'want', { placeholder: 'যেমন 3.3' })}</div><div className="calc-out" data-div-rev="" role="status"></div></div></div>);
    case 'series-parallel':
      return (<div className="calc" data-calc="sp"><div className="calc-row" role="radiogroup" aria-label="কী জুড়বেন"><label className="calc-pill"><input type="radio" name="kind" defaultValue="r" defaultChecked />{' '}রেজিস্টর</label><label className="calc-pill"><input type="radio" name="kind" defaultValue="c" />{' '}ক্যাপাসিটর</label></div><label className="calc-field wide"><span>মানগুলো (কমা দিয়ে)</span><input name="values" autoComplete="off" placeholder="রেজিস্টর: 1k, 2.2k, 470 · ক্যাপাসিটর: 100n, 10u, 22p" defaultValue="1k, 1k" /></label>{out()}</div>);
    case 'transistor-switch':
      return (<div className="calc" data-calc="transistor" data-transistors={attrValue(JSON.stringify(TRANSISTORS.filter((t) => t.hfe && t.icMa)))}><div className="calc-grid"><label className="calc-field"><span>ট্রানজিস্টর</span><select name="t" defaultValue="0">{jsxList(TRANSISTORS.filter((t) => t.hfe && t.icMa).map((t, i) => <option value={attrValue(i)}>{t.name} ({t.kind})</option>))}</select></label>{field('লোডের কারেন্ট (mA)', 'ic', { value: '70', placeholder: 'যেমন রিলে ≈ ৭০' })}{field('কন্ট্রোল ভোল্টেজ (V)', 'vin', { value: '5' })}</div>{out()}</div>);
    case '555-timer':
      return (<div className="calc" data-calc="555"><div className="calc-row" role="radiogroup" aria-label="মোড"><label className="calc-pill"><input type="radio" name="mode" defaultValue="a" defaultChecked />{' '}Astable (বারবার জ্বলা-নেভা)</label><label className="calc-pill"><input type="radio" name="mode" defaultValue="m" />{' '}Monostable (একবার টাইমার)</label></div><div className="calc-grid">{field('R1 (Ω)', 'r1', { value: '10k' })}{field('R2 (Ω) — শুধু Astable', 'r2', { value: '68k' })}{field('C (একক সহ)', 'c', { value: '10u', placeholder: 'যেমন 10u, 100n' })}</div>{out()}</div>);
    case 'battery-life':
      return (<div className="calc" data-calc="battery"><div className="calc-grid">{field('ব্যাটারির ক্ষমতা (mAh)', 'mah', { value: '2000' })}{field('প্যারালালে কয়টা সেল', 'cells', { value: '1' })}{field('প্রজেক্টের কারেন্ট (mA)', 'ma', { value: '100' })}{field('কার্যকারিতা (%)', 'eff', { value: '80' })}</div>{out()}</div>);
    default:
      return null;
  }
}

function transistorTable() {
  return (<section className="panel tool-sec"><h2>📌 জনপ্রিয় ট্রানজিস্টর ও পিন চার্ট</h2><p className="small muted">পিন বাঁ থেকে ডানে — লেখা দিকটা আপনার দিকে, পা নিচে। কোম্পানিভেদে আলাদা হতে পারে; কেনা পার্টসের ডেটাশিট মিলিয়ে নিন।</p><div className="table-wrap"><table className="tool-table"><thead><tr><th>নাম</th><th>ধরন</th><th>প্যাকেট</th><th>পিন</th><th>সর্বোচ্চ কারেন্ট</th><th>ভোল্টেজ</th><th>কাজে লাগে</th></tr></thead><tbody>{jsxList(TRANSISTORS.map((t) => <tr><td><b>{t.name}</b></td><td>{t.kind}</td><td>{t.pkg}</td><td className="pins">{t.pins}</td><td>{t.ic}</td><td>{t.v}</td><td className="small">{t.note || ''}</td></tr>))}</tbody></table></div></section>);
}

export function toolsListPage({ list }: { list: Tool[] }) {
  return (<div className="wrap section tools" data-tools-list=""><nav className="crumbs" aria-label="অবস্থান"><a href="/">হোম</a>{' '}/{' '}<span>ইলেকট্রনিক্স টুলস</span></nav><h1>🧮 ইলেকট্রনিক্স টুলস ও ক্যালকুলেটর</h1><p className="muted">স্টুডেন্ট, শখের মানুষ আর টেকনিশিয়ানদের জন্য — রেজিস্টরের রং থেকে মান, ক্যাপাসিটর কোড, ওহমের সূত্র, LED রেজিস্টর, ট্রানজিস্টর আর আরও অনেক কিছু। প্রতিটার সাথে সূত্র আর মনে রাখার সহজ নিয়ম। একদম ফ্রি।</p><div className="tool-grid">{jsxList(list.map((t) => <a className="tool-card panel" href={`/tools/${attrValue(t.key)}`}><span className="tool-emoji" aria-hidden="true">{t.emoji}</span><span className="tool-body"><b>{t.title}</b><span className="small muted">{t.summary}</span></span></a>))}</div><p className="small center">🎓 শুরু থেকে শিখতে চান?{' '}<a href="/learn">ফ্রি ইলেকট্রনিক্স ক্লাস দেখুন</a></p></div>);
}

export function toolPage({ t, others }: { t: Tool; others: Tool[] }) {
  return (<div className="wrap section tools narrow" data-tool-page={attrValue(t.key)}><nav className="crumbs" aria-label="অবস্থান"><a href="/">হোম</a>{' '}/{' '}<a href="/tools">ইলেকট্রনিক্স টুলস</a>{' '}/{' '}<span>{t.title.split(' (')[0]}</span></nav><h1>{t.emoji}{' '}{t.title}</h1><p className="muted">{t.summary}</p><section className="panel tool-calc">{calculator(t.key)}</section>{(t.formula && t.formula.length ? <section className="panel tool-sec"><h2>📐 সূত্র</h2><ul className="tool-formula">{jsxList(t.formula.map((f) => <li>{f}</li>))}</ul></section> : null)}{(t.remember && t.remember.length ? <section className="panel tool-sec tool-remember"><h2>🧠 সহজে মনে রাখার নিয়ম</h2><ul>{jsxList(t.remember.map((f) => <li>{f}</li>))}</ul></section> : null)}{(t.key === 'resistor-color-code' ? <section className="panel tool-sec"><h2>🎨 রঙের তালিকা</h2><div className="table-wrap"><table className="tool-table"><thead><tr><th>রং</th><th>অঙ্ক</th><th>গুণক</th><th>টলারেন্স</th><th>টেম্পকো</th></tr></thead><tbody>{jsxList(BANDS.map((b) => <tr><td><span className="rc-chip" style={styleOf(`background:${b.hex}`)}></span>{' '}{b.bn}</td><td>{b.digit ?? '—'}</td><td>{b.mult === null ? '—' : `×${b.mult >= 1e9 ? '1G' : b.mult >= 1e6 ? `${b.mult / 1e6}M` : b.mult >= 1e3 ? `${b.mult / 1e3}k` : b.mult}`}</td><td>{b.tol === null ? '—' : `±${b.tol}%`}</td><td>{b.ppm === null ? '—' : `${b.ppm} ppm`}</td></tr>))}</tbody></table></div></section> : null)}{(t.key === 'transistor-switch' ? transistorTable() : null)}{jsxList(t.guide.map((g) => <section className="panel tool-sec"><h2>{g.h}</h2>{(g.text ? jsxList(g.text.map((x) => <p>{x}</p>)) : null)}{(g.list ? <ul>{jsxList(g.list.map((x) => <li>{x}</li>))}</ul> : null)}</section>))}{(t.shopQuery ? <p className="center"><a className="btn btn-amber" href={`/products?q=${encodeURIComponent(t.shopQuery)}`}>🛒{' '}{t.shopLabel || 'পার্টস দেখুন'}</a>{' '}<a className="btn btn-ghost" href="/learn">🎓 ফ্রি ক্লাস</a></p> : null)}{(others.length ? <section className="tool-others"><h2>আরও টুলস</h2><ul>{jsxList(others.map((o) => <li><a href={`/tools/${attrValue(o.key)}`}>{o.emoji}{' '}{o.title.split(' (')[0]}</a></li>))}</ul></section> : null)}</div>);
}
