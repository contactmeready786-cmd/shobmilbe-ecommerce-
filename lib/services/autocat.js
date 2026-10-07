'use strict';
// Automatic categories (স্বয়ংক্রিয় ক্যাটাগরি): reads each product's name and puts it in the right
// main category → sub-category (→ sub-sub-category). Remotes are also split by AC / TV / box and by
// company (Walton, Singer, LG …). The tree follows how Bangladeshi electronics & gadget shops
// arrange the same kinds of products.
//
//   preview()                 → what would change (nothing saved)
//   apply({ ids, onlyMatched }) → creates the categories that are needed and moves the products
//   suggest(name)             → category slug for one product name (used by product import)
const { q, tx } = require('../db');

// ---------------------------------------------------------------- the tree
// [slug, name, icon, children]
const TREE = [
  ['electronics', 'ইলেকট্রনিক্স', '📟', [
    ['circuits', 'সার্কিট ও মডিউল', '🧩', [
      ['audio-amplifier', 'অডিও অ্যামপ্লিফায়ার বোর্ড', '🔊'],
      ['power-converter', 'পাওয়ার ও কনভার্টার মডিউল', '⚡'],
      ['charging-bms', 'ব্যাটারি চার্জিং ও BMS বোর্ড', '🔋'],
      ['mini-ups', 'মিনি UPS ও পাওয়ার ব্যাংক কিট', '🔌'],
      ['speed-controller', 'মোটর স্পিড ও ডিমার কন্ট্রোলার', '🎚️'],
      ['temp-controller', 'টেম্পারেচার কন্ট্রোলার ও ইনকিউবেটর', '🌡️'],
      ['mist-maker', 'মিস্ট মেকার ও হিউমিডিফায়ার মডিউল', '💨'],
      ['wireless-relay', 'ওয়াইফাই, ব্লুটুথ, RF ও রিলে মডিউল', '📡'],
    ]],
    ['sensors', 'সেন্সর', '📍'],
    ['components', 'কম্পোনেন্ট / পার্টস', '🔋', [
      ['ic', 'আইসি ও আইসি সকেট', '🔲'],
      ['capacitor', 'ক্যাপাসিটর ও ভ্যারিস্টর', '🧪'],
      ['resistor', 'রেজিস্টর ও পোটেনশিওমিটার', '〰️'],
      ['switch-connector', 'সুইচ, কানেক্টর ও জাম্পার তার', '🔘'],
      ['led-component', 'এলইডি (LED)', '💡'],
      ['relay', 'রিলে', '🔁'],
    ]],
    ['motors-pumps', 'মোটর ও পাম্প', '⚙️', [
      ['dc-motor', 'ডিসি ও গিয়ার মোটর', '⚙️'],
      ['servo-bldc', 'সার্ভো ও BLDC মোটর', '🤖'],
      ['water-pump', 'পানির পাম্প', '💧'],
      ['motor-accessories', 'চাকা, ফ্যান ও মোটর অ্যাক্সেসরিজ', '🛞'],
    ]],
    ['battery-charger', 'ব্যাটারি ও চার্জার', '🔋'],
    ['audio-mic', 'মাইক্রোফোন ও অডিও', '🎤'],
  ]],
  ['soldering', 'সোল্ডারিং ও টুলস', '🔥', [
    ['soldering-iron', 'সোল্ডারিং আয়রন ও স্টেশন', '🔥'],
    ['iron-tips', 'আয়রন বিট, টিপ ও কয়েল', '📍'],
    ['solder-accessories', 'আয়রন স্ট্যান্ড ও টিপ ক্লিনার', '🧽'],
    ['solder-wire', 'রাং ও সোল্ডারিং তার', '🧵'],
    ['flux-paste', 'ফ্লাক্স ও সোল্ডার পেস্ট', '🧴'],
    ['chemicals', 'কেমিক্যাল, থিনার ও থার্মাল পেস্ট', '🧪'],
    ['glue-tape', 'গ্লু ও টেপ', '🩹'],
    ['meters', 'মাল্টিমিটার, মিটার ও টেস্টার', '📏'],
    ['repair-tools', 'মোবাইল ও পিসিবি রিপেয়ারিং টুলস', '📱'],
    ['hand-tools', 'স্ক্রু ড্রাইভার, প্লায়ার্স ও হ্যান্ড টুলস', '🪛'],
  ]],
  ['electrical', 'ইলেকট্রিক্যাল', '🔌', [
    ['lights', 'এলইডি বাল্ব ও লাইট', '💡'],
    ['smart-switch', 'স্মার্ট সুইচ ও সেন্সর সুইচ', '🎛️'],
    ['cable-accessories', 'ক্যাবল ক্লিপ, টাই ও হিট শ্রিংক', '🧷'],
    ['fan-parts', 'ফ্যান ক্যাপাসিটর ও পার্টস', '🌀'],
    ['fuse', 'ফিউজ ও ফিউজ বেস', '🧯'],
    ['adapter-power', 'অ্যাডাপ্টার ও পাওয়ার সাপ্লাই', '🔌'],
  ]],
  ['remote', 'রিমোট কন্ট্রোল', '🎛️', [
    ['ac-remote', 'এসি রিমোট', '❄️'],
    ['tv-remote', 'টিভি রিমোট', '📺'],
    ['box-remote', 'সেট-টপ ও অ্যান্ড্রয়েড বক্স রিমোট', '📦'],
  ]],
  ['fashion', 'ফ্যাশন', '👗', [
    ['women', 'মেয়েদের', '👩', [
      ['hijab', 'হিজাব', '🧕'],
      ['inner-cap', 'ইনার ক্যাপ', '🧢'],
      ['jewelry', 'জুয়েলারি (পায়েল, বেলি চেইন)', '💍'],
      ['women-care', 'বিউটি ও কেয়ার', '💄'],
    ]],
    ['men', 'ছেলেদের', '👨', [
      ['trimmer', 'ট্রিমার ও হেয়ার ক্লিপার', '✂️'],
    ]],
  ]],
  ['packaging', 'প্যাকেজিং ম্যাটেরিয়ালস', '📦'],
  ['digital-products', 'ডিজিটাল প্রোডাক্ট', '💾'],
  ['home-appliance', 'হোম অ্যাপ্লায়েন্স', '🏠', [
    ['personal-care', 'পার্সোনাল কেয়ার ও হেলথ', '💆'],
    ['household', 'ঘরের দরকারি জিনিস', '🧽'],
  ]],
];

// Remote brands, in the order they are written in shops. A company gets its own sub-category
// when it has at least BRAND_MIN remotes of that kind; the rest go to "অন্যান্য কোম্পানি".
const BRAND_MIN = 3;
const BRANDS = [
  ['walton', 'Walton', /walton|ওয়ালটন/], ['singer', 'Singer', /singer|সিঙ্গার/], ['lg', 'LG', /\blg\b|এলজি/],
  ['samsung', 'Samsung', /samsung|স্যামসাং/], ['gree', 'Gree', /\bgree\b/], ['general', 'General', /general|fujitsu|o general/],
  ['midea', 'Midea', /midea|media ac/], ['haier', 'Haier', /haier/], ['vision', 'Vision', /vision|\bvisio\b/], ['rangs', 'Rangs', /rangs/],
  ['panasonic', 'Panasonic', /panasonic/], ['chigo', 'Chigo', /chigo/], ['daikin', 'Daikin', /daikin|york|ascon/],
  ['eco-plus', 'Eco+', /eco ?\+|eco ?plus|ecoplus/], ['transtec', 'Transtec', /transtec|hamim/], ['whirlpool', 'Whirlpool', /whirlpool/],
  ['sony', 'Sony', /sony|bravia/], ['tcl', 'TCL', /\btcl\b/], ['jamuna', 'Jamuna', /jamuna|যমুনা/], ['sharp', 'Sharp', /sharp/],
  ['hisense', 'Hisense', /hisense/], ['mitsubishi', 'Mitsubishi', /mitsubi+shi/], ['aux', 'AUX', /\baux\b|ykr-/], ['enviro', 'Enviro', /enviro/],
  ['minister', 'Minister', /minister/], ['jvco', 'JVCO', /jvco/], ['vertex', 'Vertex', /vertex/], ['metz', 'Metz', /metz/],
  ['akash', 'Akash', /akash/], ['china', 'চায়না', /\bchin(a|ese)\b/],
];
const UNIVERSAL = /universal|1000 in 1|\d+ brands|master remote/;

// ---------------------------------------------------------------- rules (first match wins)
const R = [];
const rule = (slug, re, not) => R.push([slug, re, not || null]);
// fashion / home first (their words are clear)
rule('digital-products', /gift ?card|license key|licen[cs]e|activation key|product key|subscription|premium account|e-?book|online course|software|ডিজিটাল/);
rule('packaging', /bubble ?wrap|carton|courier (bag|poly|flyer)|poly ?bag|polythene|zipper bag|zip ?lock bag|packaging|packing (box|bag|material)|stretch (film|wrap)|shrink wrap|mailer (bag|box)|প্যাকেজিং|কার্টন/);
rule('hijab', /hijab|হিজাব/);
rule('inner-cap', /inner ?cap|ইনার ক্যাপ/);
rule('jewelry', /anklet|payel|পায়েল|belly chain|necklace|bracelet|earring|nose ?pin/);
rule('women-care', /(razor|shaver|epilator|hair remov).*(women|lady|ladies|female)|(women|lady|ladies|female).*(razor|shaver|epilator)/);
rule('trimmer', /trimmer|hair clipper|clipper|shaver|beard|kemei|ট্রিমার/, /nail|plier|tool/);
rule('personal-care', /massag/);
rule('household', /magic sponge|melamine|spray gun|car wash|weight scale|kitchen scale/);
// electrical things that also have words like "remote", "sensor", "led"
rule('smart-switch', /(switch|lamp holder|holder|photocell|socket).*(remote|smart|timer|sensor|pir|photo|day ?night|auto)|(remote|smart|timer|sensor|pir|photo|day ?night).*(switch|lamp holder|photocell)|remote control device|\bb22\b.*plug|plug.*sensor|(sensor|pir).*\be27\b/);
// soldering & tools
rule('solder-accessories', /tip (refresher|cleaner)|refresher|tip.*cleaner|head cleaner|iron stand|soldering stand|stand holder|helping hand|sponge tray/);
rule('repair-tools', /\bmat\b|opening tool|pry|opener|crowbar|separation|diamond wire|screw pack|pcb holder|pcb stand|magnif|dispenser|plastic.*bottle|press bottle|bottle for|\bbrush\b|underfill|casing opening|disassemble|repair tool set/);
rule('motor-accessories', /drill chuck|wheel|tyre|tire|propeller|8045|motor fan/, /gear motor for/);
rule('hand-tools', /screw ?driver|plier|cutter|tweezer|knife|blade|stripper|nipper|snips|obeng|tool kit|wrench|spanner/, /soldering|motor/);
rule('iron-tips', /^(?=.*(solder|iron|900m|t12))(?=.*(\btips?\b|\bbits?\b|coil|heating core|heating element|replacement element|iron head|900m-t|t12-))/, /relay/);
rule('soldering-iron', /soldering iron|soldering station|solder station|hot air|heat ?gun|blower|tatal|desoldering station|সোল্ডারিং আয়রন/);
rule('solder-wire', /solder(ing)? wire|\brang\b|রাং|tin lead|lead rang|desoldering braid|wick|copper pcb soldering wire|tin solder wire/);
rule('chemicals', /thermal|heat ?sink|thinner|contact cleaner|\b530\b|cleaner|isopropyl|alcohol/);
rule('glue-tape', /glue|tape|adhesive|kapton|b-7000|t-7000|e-?8000/);
rule('flux-paste', /flux|solder(ing)? paste|tin paste|rosin|baku|bga|uv curing|solder ink|jalai/);
// circuits & modules
rule('ic', /\bic\b|ic socket|op ?amp|ne555|lm358|\b555\b|timer ic/, /board|module|circuit/);
rule('temp-controller', /thermostat|temperature (and humidity )?controller|humidity controller|incubator|stc-? ?\d|w1209|xh-w3001|turning (motor|control)/);
rule('speed-controller', /speed control|\bpwm\b|\besc\b|dimmer|\bscr\b|fan driver|fan circuit|motor controller|speed regulator|voltage regulator/);
rule('meters', /multimeter|multi meter|clamp meter|(?<!potentio)meter\b|uni-?t\b|\but ?\d{2,3}[a-z+]*\b|tester|thermometer|hygrometer|voltmeter|ammeter|fault finder|continuity|charger doctor|battery monitor|capacity indicator|মাল্টিমিটার/);
rule('mist-maker', /mist|humidifier|fogger|atomiz/);
rule('mini-ups', /mini ups|ups (board|kit|circuit|module|setup)|power ?bank|পাওয়ার ব্যাংক/);
rule('charging-bms', /\bbms\b|protection (board|circuit)|charging (module|board|control)|tp4056|tc4056|charger (pcb|board|module)/);
rule('audio-amplifier', /amplifier|\bamp\b|pam8403|tpa ?\d|audio receiver|bluetooth (stereo|audio)|stereo|\bla4508\b.*(board|circuit)/, /\bic\b(?!.*(board|circuit))/);
rule('power-converter', /buck|boost|step[ -]?(up|down)|converter|dc-dc|lm2596|xl\d{4}|mt-?3608|high voltage|power (supply )?module/);
rule('wireless-relay', /esp8266|esp32|nodemcu|wi-?fi|433 ?mhz|\brf\b|bluetooth (adapter|dongle|module)|dongle|relay module/);
rule('audio-mic', /microphone|\bmic\b|ahuja/);
rule('fan-parts', /fan capacitor|ceiling fan/);
rule('capacitor', /capacitor|varistor|\bmov\b|\d+ ?uf\b/);
rule('resistor', /resistor|potentiometer|preset/);
rule('relay', /relay/);
rule('led-component', /\bled\b.*(smd|5 ?mm|3 ?mm|pcs)|(smd|5 ?mm|3 ?mm).*\bled\b/, /220 ?v|bulb/);
rule('lights', /bulb|lamp|downlight|\blight\b.*(220|watt|\d+ ?w\b)|\bled\b.*(220 ?v|ac 220)|(220 ?v|ac 220|\d+ ?watt).*\bled\b|বাল্ব/);
rule('adapter-power', /adapter|power supply|এডাপ্টার/, /module/);
rule('switch-connector', /push button|switch|socket|connector|balun|jumper|breadboard|alligator/);
rule('sensors', /sensor|সেন্সর/);
rule('water-pump', /pump|পাম্প/);
rule('servo-bldc', /servo|brushless|bldc|outrunner|a2212/);
rule('dc-motor', /motor|মোটর/);
rule('battery-charger', /battery|charger|lipo|18650|ব্যাটারি/);
rule('cable-accessories', /cable clip|cable tie|zip (tie|wrap)|heat ?shrink|sleeve/);
rule('fuse', /fuse/);
// last chance: an un-named board/module/circuit
rule('circuits', /module|board|circuit|সার্কিট/);

function norm(name) {
  return String(name || '').toLowerCase().replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)).replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
}

// Remote? → { kind: 'ac-remote'|'tv-remote'|'box-remote', brand: slug|'universal'|null }
function remoteOf(n) {
  if (!/remote|রিমোট/.test(n)) return null;
  if (/(switch|lamp holder|remote control device|timer switch)/.test(n)) return null;
  let kind;
  if (/set ?(up|top)? ?box|akash|\bdth\b|mxq|\btx ?\d|t-x ?\d|t9\d|x96|tv ?box|android box/.test(n)) kind = 'box-remote';
  else if (/\bac\b|a\/c|air ?-?condition|aircon|split|window type|inverter ac|\bac-\d|\barc\d/.test(n)) kind = 'ac-remote';
  else if (!/\btv\b|television|\bled\b|\blcd\b|android|smart|voice|magic|4k/.test(n) && /daikin|york|gree|chigo|midea|eco ?(\+|plus)|whirlpool|\baux\b|enviro|mitsubi/.test(n)) kind = 'ac-remote';
  else kind = 'tv-remote';
  // the company written first in the name
  let brand = null;
  let at = Infinity;
  for (const [slug, , re] of BRANDS) {
    const m = n.match(re);
    if (m && m.index < at) { at = m.index; brand = slug; }
  }
  if (!brand && UNIVERSAL.test(n)) brand = 'universal';
  return { kind, brand };
}

// slug for one product name (remotes: the type; the brand is handled when applying)
function classify(name) {
  const n = norm(name);
  const r = remoteOf(n);
  if (r) return { slug: r.kind, remote: r };
  for (const [slug, re, not] of R) {
    if (re.test(n) && !(not && not.test(n))) return { slug };
  }
  return null;
}
function suggest(name) { const c = classify(name); return c ? c.slug : null; }

// ---------------------------------------------------------------- saving
function flatTree() {
  const out = [];
  const walk = (nodes, parent) => nodes.forEach(([slug, name, icon, kids], i) => {
    out.push({ slug, name, icon, parent, sort: i });
    if (kids) walk(kids, slug);
  });
  walk(TREE, null);
  return out;
}
const SEED_NAMES = { electronics: 'ইলেকট্রনিক্স', circuits: 'সার্কিট', components: 'কম্পোনেন্ট', soldering: 'সোল্ডারিং', electrical: 'ইলেকট্রিক্যাল', fashion: 'ফ্যাশন' };

// Create (or put in place) the categories with these slugs, parents first. Returns slug → id.
async function ensureCategories(t, wanted) {
  const all = flatTree();
  const need = new Set();
  const add = (slug) => {
    const node = all.find((x) => x.slug === slug) || wanted.extra.get(slug);
    if (!node || need.has(slug)) return;
    if (node.parent) add(node.parent);
    need.add(slug);
  };
  wanted.slugs.forEach(add);
  const ids = new Map();
  for (const slug of need) {
    const node = all.find((x) => x.slug === slug) || wanted.extra.get(slug);
    const parentId = node.parent ? ids.get(node.parent) : null;
    const cur = (await t.query('SELECT id, name FROM categories WHERE slug=$1', [slug])).rows[0];
    if (cur) {
      // the shop's first six categories get their new place (and a clearer name if never renamed)
      const rename = SEED_NAMES[slug] && cur.name === SEED_NAMES[slug] && SEED_NAMES[slug] !== node.name;
      await t.query(`UPDATE categories SET parent_id=$1${rename ? ', name=$3' : ''} WHERE id=$2`, rename ? [parentId, cur.id, node.name] : [parentId, cur.id]);
      if (SEED_NAMES[slug] && !node.parent) await t.query('UPDATE categories SET sort=$1 WHERE id=$2', [node.sort || 0, cur.id]);
      ids.set(slug, cur.id);
    } else {
      const r = (await t.query('INSERT INTO categories(name, slug, icon, sort, active, parent_id) VALUES($1,$2,$3,$4,true,$5) RETURNING id',
        [node.name, slug, node.icon || '📦', node.sort || 0, parentId])).rows[0];
      ids.set(slug, r.id);
    }
  }
  return ids;
}

// What every product would get. Remote brands get a sub-category only when there are enough of them.
async function plan({ ids = null } = {}) {
  const products = await q(`SELECT p.id, p.name, p.category_id, c.slug AS category_slug, c.name AS category_name
    FROM products p LEFT JOIN categories c ON c.id=p.category_id ${ids ? 'WHERE p.id = ANY($1::int[])' : ''} ORDER BY p.id`, ids ? [ids] : []);
  const rows = products.map((p) => ({ ...p, c: classify(p.name) }));
  // brand counts per remote kind (whole shop, so small brands still group well later)
  const allRemotes = (await q('SELECT name FROM products')).map((p) => remoteOf(norm(p.name))).filter(Boolean);
  const count = new Map();
  for (const r of allRemotes) if (r.brand) count.set(r.kind + '|' + r.brand, (count.get(r.kind + '|' + r.brand) || 0) + 1);
  const all = flatTree();
  const extra = new Map();
  for (const r of rows) {
    if (!r.c) continue;
    let slug = r.c.slug;
    if (r.c.remote) {
      const { kind, brand } = r.c.remote;
      const big = brand && (brand === 'universal' || count.get(kind + '|' + brand) >= BRAND_MIN);
      const bslug = big ? brand : 'other';
      const bname = brand === 'universal' ? 'ইউনিভার্সাল রিমোট' : big ? (BRANDS.find((b) => b[0] === brand) || [])[1] : 'অন্যান্য কোম্পানি';
      slug = `${kind}-${bslug}`;
      if (!extra.has(slug)) extra.set(slug, { slug, name: bname, icon: kind === 'ac-remote' ? '❄️' : kind === 'tv-remote' ? '📺' : '📦', parent: kind, sort: bslug === 'other' ? 99 : bslug === 'universal' ? 98 : 0 });
    }
    r.to = slug;
    const node = all.find((x) => x.slug === slug) || extra.get(slug);
    const path = [];
    for (let x = node; x; x = all.find((y) => y.slug === x.parent) || extra.get(x.parent)) path.unshift(x.name);
    r.path = path.join(' › ');
  }
  // brand sub-categories sorted by size
  const sizes = new Map();
  rows.forEach((r) => { if (r.to && extra.has(r.to)) sizes.set(r.to, (sizes.get(r.to) || 0) + 1); });
  for (const [slug, node] of extra) if (node.sort === 0) node.sort = 50 - Math.min(49, sizes.get(slug) || 0);
  return { rows, extra };
}

async function preview() {
  const { rows } = await plan();
  return rows.map((r) => ({ id: r.id, name: r.name, from: r.category_name || '', to: r.to || null, path: r.path || '', same: !!r.to && r.to === r.category_slug }));
}

// Move products. ids: only these products (null = all). onlyMatched: leave unknown products where they are.
async function apply({ ids = null } = {}) {
  const { rows, extra } = await plan({ ids });
  const todo = rows.filter((r) => r.to);
  if (!todo.length) return { moved: 0, unknown: rows.length };
  return tx(async (t) => {
    const map = await ensureCategories(t, { slugs: [...new Set(todo.map((r) => r.to))], extra });
    let moved = 0;
    for (const r of todo) {
      const cid = map.get(r.to);
      if (cid && cid !== r.category_id) { await t.query('UPDATE products SET category_id=$1, updated_at=now() WHERE id=$2', [cid, r.id]); moved++; }
    }
    // the old top-level "সার্কিট"/"কম্পোনেন্ট" etc. now live inside their main category even if no product moved there
    await ensureCategories(t, { slugs: ['circuits', 'components', 'soldering', 'electrical', 'fashion'].filter((s) => s), extra: new Map() });
    return { moved, unknown: rows.length - todo.length };
  });
}

module.exports = { TREE, classify, suggest, preview, apply, remoteOf, norm };
