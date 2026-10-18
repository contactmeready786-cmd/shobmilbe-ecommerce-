// সবমিলবে admin — পণ্য আমদানি (product import from a file, a link or many links) and
// "more pictures from the old site" (each product's own page).
import { h, Fragment, paint } from '../jsx.js';
import { $, $all, bn, sleep } from '../dom.js';
import { money, postJSON, toast } from './core.js';
import { upload } from './images.js';

void Fragment;
type Item = {
  ref?: string; title: string; price: number; old_price?: number; images: string[]; brand?: string; category?: string; link?: string;
  stock?: number | null; in_stock?: boolean; exists?: { sku?: string } | null; _noPics?: boolean;
};
type Link = { url: string; kind?: string };
// what the server answers (lib/admin/import.tsx, lib/admin/morepics.tsx)
type ReadAnswer = { format?: string; items?: Item[]; links?: Link[]; next?: string | null; notes?: string[]; columns?: string[]; unknownColumns?: boolean };
type Match = { id: number; name: string; sku?: string; image?: string; emoji?: string; reasons?: string[] };
type SaveAnswer = { result: 'added' | 'updated' | 'exists' | 'duplicate' | 'error'; id?: number; sku?: string; name?: string; active?: boolean; matches?: Match[]; images?: number[]; message?: string };
type PlanAnswer = { feedItems: number; matched: number; full: number; notInShop: number; products: Pics[]; max: number; missing?: Item[]; inTrash?: { title: string }[]; extra?: string[]; sitemapRead: boolean; sitemapCount: number; oldTotal: number };
type FindAnswer = { images?: string[]; rule?: string; confirmed?: boolean; error?: string; note?: string };
type AttachAnswer = { added: number; repeat: number; total: number };
type PageAnswer = { error?: string; item: Item; trashed: boolean; exists: { id: number; name: string; sku: string; pics: number; thumb: string } | null };
const Thumb = ({ it }: { it: { images?: string[] } }) => (it.images?.[0] ? <img src={it.images[0]} alt="" loading="lazy" referrerpolicy="no-referrer" /> : <span>📦</span>);
const unloadGuard = (running: () => boolean) => window.addEventListener('beforeunload', (e) => { if (running()) { e.preventDefault(); e.returnValue = ''; } });

/** bring one picture through our server, resize + fingerprint it here, upload it */
async function copyPic(u: string): Promise<{ id: number }> {
  const r = await fetch(`/admin/api/import/image?u=${encodeURIComponent(u)}`, { credentials: 'same-origin' });
  if (!r.ok) throw new Error('no image');
  return upload(await r.blob(), { max: 1200, import: true });
}
/** each picture in turn; one that can't be brought is skipped */
async function copyAll(urls: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const u of urls) { try { ids.push((await copyPic(u)).id); } catch { /* skipped */ } }
  return ids;
}
/** run `job` for every task with `n` workers side by side (pausing while `paused()` says so) */
async function workers<T>(list: T[], n: number, paused: () => boolean, job: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < list.length) {
      if (paused()) { await sleep(500); continue; }
      await job(list[next++]);
    }
  };
  await Promise.all(Array.from({ length: n }, worker));
}

function importer(imp: HTMLElement): void {
  const canOverride = imp.getAttribute('data-can-override') === '1';
  const K = { added: 0, updated: 0, exists: 0, duplicate: 0, error: 0 };
  const st = { items: [] as Item[], running: false, paused: false, stop: false, k: K, done: 0, total: 0 };
  const readStatus = $('[data-imp-read-status]')!;
  const step = (n: number) => { for (const s of $all('[data-imp-step]', imp)) s.hidden = Number(s.getAttribute('data-imp-step')) > n; };
  const say = (text: Node | string, bad = false) => { readStatus.hidden = !text; paint(readStatus, text); readStatus.classList.toggle('warn', bad); };

  // tabs
  for (const t of $all('[data-imp-tab]', imp)) {
    t.addEventListener('click', () => {
      for (const x of $all('[data-imp-tab]', imp)) x.classList.toggle('on', x === t);
      for (const p of $all('[data-imp-pane]', imp)) p.hidden = p.getAttribute('data-imp-pane') !== t.getAttribute('data-imp-tab');
      say('');
    });
  }

  // ----- step 1: read -----
  const fileInput = $<HTMLInputElement>('[data-imp-file]', imp)!;
  const fileBtn = $<HTMLButtonElement>('[data-imp-read="file"]', imp)!;
  const drop = $('[data-imp-drop]', imp)!;
  let pickedFile: File | null = null;
  const setFile = (f?: File | null) => {
    pickedFile = f || null;
    $('[data-imp-filename]', imp)!.textContent = f ? `✅ ${f.name} (${bn(Math.max(1, Math.round(f.size / 1024)))} KB)` : '';
    fileBtn.disabled = !f;
  };
  fileInput.addEventListener('change', () => setFile(fileInput.files?.[0]));
  for (const ev of ['dragover', 'dragenter']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer?.files[0]; if (f) setFile(f); });

  let found: Item[] = [];
  let notes: string[] = [];
  const addResult = (j: ReadAnswer) => {
    found.push(...(j.items || []));
    for (const n of j.notes || []) if (!notes.includes(n)) notes.push(n);
    if (j.unknownColumns) notes.push('⚠️ ফাইলের কলামের নাম চেনা যায়নি। প্রথম লাইনে title / name / পণ্যের নাম, price / দাম, image_link / ছবি — এমন নাম দিন (নমুনা ফাইল দেখুন)।');
  };
  const busy = (on: boolean) => { for (const b of $all<HTMLButtonElement>('[data-imp-read]', imp)) b.disabled = on || (b === fileBtn && !pickedFile); };
  const read = (body: unknown) => postJSON<ReadAnswer>('/admin/api/import/read', body);

  // Visit a list of pages (category pages, sitemaps, product pages) a few at a time.
  const crawl = async (start: Link[]) => {
    const queue = start.slice();
    const seen = new Set(queue.map((l) => l.url));
    let pages = 0;
    let failed = 0;
    st.stop = false;
    const progress = () => say(<>⏳ পেজ পড়া হচ্ছে… {bn(pages)} / {bn(pages + queue.length)} — পণ্য পাওয়া গেছে {bn(found.length)}টি{failed ? ` (পড়া যায়নি ${bn(failed)}টি)` : ''}{' '}<button type="button" className="link-btn" data-imp-crawl-stop="">থামান</button></>);
    const worker = async (): Promise<void> => {
      while (!st.stop && queue.length) {
        const l = queue.shift()!;
        try {
          const j = await read({ url: l.url, single: true });
          addResult(j);
          for (const x of j.links || []) if (!seen.has(x.url) && pages + queue.length < 6000) { seen.add(x.url); queue.push(x); }
          if (j.next && !seen.has(j.next)) { seen.add(j.next); queue.push({ url: j.next, kind: 'list' }); }
        } catch { failed++; }
        pages++;
        progress();
      }
    };
    progress();
    await Promise.all([worker(), worker(), worker()]);
  };
  imp.addEventListener('click', (e) => { if ((e.target as Element).closest('[data-imp-crawl-stop]')) st.stop = true; });

  const finishRead = () => {
    busy(false);
    // the same product twice in one source: keep the first
    const seenRef = new Set<string>();
    const seenName = new Set<string>();
    const clean: Item[] = [];
    let twice = 0;
    for (const it of found) {
      const nk = `${(it.title || '').toLowerCase().replace(/\s+/g, ' ').trim()}|${it.price || ''}`;
      if (seenRef.has(String(it.ref)) || seenName.has(nk)) { twice++; continue; }
      seenRef.add(String(it.ref));
      seenName.add(nk);
      clean.push(it);
    }
    if (twice) notes.push(`${bn(twice)}টি পণ্য একই তালিকায় দুইবার ছিল — একবারই নেওয়া হবে।`);
    // A picture used by many different products is a logo / banner, not a product photo — leave it out
    // (otherwise every product after the first would look like a duplicate).
    const useCount = new Map<string, number>();
    for (const it of clean) for (const u of it.images) useCount.set(u, (useCount.get(u) || 0) + 1);
    const shared = new Set([...useCount].filter(([, n]) => n >= 3 && n >= clean.length * 0.05).map(([u]) => u));
    if (shared.size) {
      for (const it of clean) it.images = it.images.filter((u) => !shared.has(u));
      notes.push(`${bn(shared.size)}টি ছবি অনেকগুলো পণ্যে একই ছিল (যেমন লোগো/ব্যানার) — ওগুলো বাদ দিয়ে শুধু পণ্যের নিজের ছবি নেওয়া হবে।`);
    }
    st.items = clean;
    if (!clean.length) { say(`কোনো পণ্য পাওয়া যায়নি। ${notes.length ? notes.join(' ') : 'লিংক/ফাইলটি ঠিক আছে কি না দেখুন, অথবা অন্য পদ্ধতি চেষ্টা করুন।'}`, true); return; }
    say('');
    preview();
  };
  const readFile = (f: File, binary: boolean) => new Promise<{ name: string; base64?: string; text?: string }>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('ফাইলটি খোলা যায়নি।'));
    r.onload = () => resolve(binary ? { name: f.name, base64: String(r.result).split(',')[1] || '' } : { name: f.name, text: String(r.result) });
    if (binary) r.readAsDataURL(f); else r.readAsText(f, 'utf-8');
  });
  const startRead = async (kind: string | null) => {
    found = [];
    notes = [];
    busy(true);
    try {
      if (kind === 'file') {
        if (!pickedFile) { busy(false); return; }
        if (pickedFile.size > 3 * 1024 * 1024) { busy(false); say('ফাইলটি ৩ MB-এর বেশি বড়। ফাইলটি দুই ভাগ করে আলাদা আলাদা দিন।', true); return; }
        say('⏳ ফাইল পড়া হচ্ছে…');
        const binary = /\.(xlsx|xls)$/i.test(pickedFile.name) || /spreadsheet|excel/.test(pickedFile.type);
        const j = await read({ file: await readFile(pickedFile, binary) });
        addResult(j);
        if ((j.links || []).length) await crawl(j.links!);
      } else if (kind === 'many') {
        const lines = ($<HTMLTextAreaElement>('[data-imp-links]', imp)?.value || '').split(/\s+/).filter((x) => /^https?:\/\/\S+\.\S+/i.test(x));
        if (!lines.length) { busy(false); say('অন্তত একটা লিংক দিন (https:// দিয়ে শুরু)।', true); return; }
        await crawl(lines.slice(0, 3000).map((u) => ({ url: u, kind: 'page' })));
      } else {
        const url = ($<HTMLInputElement>('[data-imp-url]', imp)?.value || '').trim();
        if (!url) { busy(false); say('লিংক দিন।', true); return; }
        say('⏳ লিংক খোলা হচ্ছে… (বড় ফিড হলে ১০-২০ সেকেন্ড লাগতে পারে)');
        const j = await read({ url });
        addResult(j);
        const more: Link[] = (j.links || []).slice();
        if (j.next) more.push({ url: j.next, kind: 'list' });
        if (more.length) await crawl(more);
      }
      finishRead();
    } catch (err) { busy(false); say(`❌ ${(err as Error).message}`, true); }
  };
  for (const b of $all('[data-imp-read]', imp)) b.addEventListener('click', () => void startRead(b.getAttribute('data-imp-read')));
  $('[data-imp-url]', imp)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void startRead('link'); } });

  // ----- step 2: preview -----
  const preview = () => {
    const items = st.items;
    const noPrice = items.filter((it) => !(it.price > 0)).length;
    const noImg = items.filter((it) => !it.images.length).length;
    const noBrand = items.filter((it) => !it.brand).length;
    const had = items.filter((it) => it.exists).length;
    $('[data-imp-found]', imp)!.textContent = `${bn(items.length)}টি পণ্য`;
    paint($('[data-imp-notes]', imp), notes.map((n) => <p className="small muted">ℹ️ {n}</p>));
    const Chip = ({ cls, text }: { cls: string; text: string }) => <span className={`imp-chip ${cls}`}>{text}</span>;
    paint($('[data-imp-check]', imp),
      <Chip cls="good" text={`✅ নাম আছে: ${bn(items.length)}`} />,
      <Chip cls={noPrice ? 'bad' : 'good'} text={noPrice ? `⛔ দাম নেই: ${bn(noPrice)} (এগুলো বাদ যাবে)` : '✅ সবগুলোর দাম আছে'} />,
      <Chip cls={noImg ? 'warn' : 'good'} text={noImg ? `⚠️ ছবি নেই: ${bn(noImg)}` : '✅ সবগুলোর ছবি আছে'} />,
      <Chip cls={noBrand ? 'warn' : 'good'} text={noBrand ? `ব্র্যান্ড নেই: ${bn(noBrand)} (ঐচ্ছিক)` : '✅ সবগুলোর ব্র্যান্ড আছে'} />,
      had ? <Chip cls="" text={`↩️ আগে আনা হয়েছে: ${bn(had)}`} /> : null);
    const LIMIT = 150;
    paint($('[data-imp-rows]', imp), items.slice(0, LIMIT).map((it) => {
      const problems: Node[] = [];
      if (!(it.price > 0)) problems.push(<span className="bad">দাম নেই — বাদ যাবে</span>);
      if (!it.images.length) problems.push(<span className="warn">ছবি নেই</span>);
      if (it.exists) problems.push(<span className="muted">আগে আনা হয়েছে (SKU {it.exists.sku || '—'})</span>);
      return (
        <tr><td className="thumb"><Thumb it={it} /></td>
          <td><b>{it.title}</b>{it.link ? <><br /><a className="small muted" href={it.link} target="_blank" rel="noopener noreferrer">আসল পেজ ↗</a></> : null}</td>
          <td className="small">{it.brand || <span className="muted">—</span>}</td>
          <td className="num">{it.price > 0 ? money(it.price) : '—'}{(it.old_price || 0) > it.price ? <><br /><s className="small muted">{money(it.old_price)}</s></> : null}</td>
          <td className="num">{bn(it.images.length)}</td>
          <td className="small">{it.category || '—'}</td>
          <td className="num">{it.stock !== null && it.stock !== undefined ? bn(it.stock) : it.in_stock === false ? '০' : <span className="muted">—</span>}</td>
          <td className="small">{problems.length ? problems.flatMap((p, i) => (i ? [<br />, p] : [p])) : <span className="good">ঠিক আছে</span>}</td></tr>
      );
    }));
    $('[data-imp-more]', imp)!.textContent = items.length > LIMIT ? `প্রথম ${bn(LIMIT)}টি দেখানো হলো — আমদানির সময় সব ${bn(items.length)}টিই আনা হবে।` : '';
    step(2);
    $('[data-imp-step="2"]', imp)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('[data-imp-reset]', imp)?.addEventListener('click', () => { st.items = []; step(1); say(''); });

  // ----- step 3: import -----
  const opts = () => {
    const v = (n: string) => { const el = imp.querySelector<HTMLInputElement>(`[name="${n}"]`); return el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; };
    return { cat_mode: v('imp_cat_mode'), category_id: v('imp_cat_id'), create_category: v('imp_create_cat'), default_stock: v('imp_stock'),
      existing: v('imp_existing'), active: v('imp_active'), hide_no_image: v('imp_hide_noimg') };
  };
  const draw = () => {
    for (const [k, n] of Object.entries(st.k)) { const el = $(`[data-imp-k="${k}"]`, imp); if (el) el.textContent = bn(n); }
    $('[data-imp-bar]', imp)!.style.width = `${st.total ? Math.round((st.done * 100) / st.total) : 0}%`;
    $('[data-imp-count]', imp)!.textContent = `${bn(st.done)} / ${bn(st.total)} টি পণ্য দেখা হয়েছে`;
  };
  const logList = $('[data-imp-log]', imp)!;
  const log = (li: Node) => { $('[data-imp-log-title]', imp)!.hidden = false; logList.appendChild(li); };

  // bring each picture through our server, resize + fingerprint it in the browser, upload it
  const copyImages = (it: Item) => copyAll((it.images || []).slice(0, 6));
  let saveChain: Promise<unknown> = Promise.resolve();
  const save = (it: Item, ids: number[], allow = false): Promise<SaveAnswer> => {
    const job = saveChain.then(() => postJSON<SaveAnswer>('/admin/api/import/save', { item: it, images: ids, options: opts(), allow_duplicate: allow ? 1 : 0 }));
    saveChain = job.catch(() => {});
    return job;
  };
  const handle = (it: Item, ids: number[], r: SaveAnswer) => {
    if (r.result === 'duplicate') {
      st.k.duplicate++;
      const btn = canOverride ? <button type="button" className="btn btn-ghost btn-sm" data-imp-force="">তবুও যোগ করুন</button> as HTMLButtonElement : null;
      const li = (
        <li className="dup-item is-block"><span className="dup-thumb"><Thumb it={it} /></span><div className="dup-info"><b>{it.title}</b>
          <span className="dup-why">⛔ দোকানে আগে থেকেই আছে: {(r.matches || []).flatMap((m, i) => [i ? <br /> : null,
            <a href={`/admin/products/${m.id}`} target="_blank" rel="noopener">{m.name}{m.sku ? ` (SKU ${m.sku})` : ''}</a>, ` — ${(m.reasons || []).join(' · ')}`])}</span></div>{btn}</li>
      );
      btn?.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '⏳';
        try {
          const r2 = await save(it, r.images || ids, true);
          if (r2.result === 'added') {
            st.k.duplicate--;
            st.k.added++;
            draw();
            li.classList.remove('is-block');
            btn.replaceWith(<a className="btn btn-ghost btn-sm" href={`/admin/products/${r2.id}`} target="_blank">✅ যোগ হয়েছে (SKU {r2.sku})</a>);
          } else { btn.disabled = false; btn.textContent = 'তবুও যোগ করুন'; toast(r2.message || 'যোগ করা যায়নি'); }
        } catch (e) { btn.disabled = false; btn.textContent = 'তবুও যোগ করুন'; toast((e as Error).message); }
      });
      log(li);
    } else if (r.result === 'error') {
      st.k.error++;
      log(<li className="dup-item is-warn"><span className="dup-thumb"><Thumb it={it} /></span><div className="dup-info"><b>{it.title || '(নাম নেই)'}</b><span className="dup-why">⚠️ {r.message || 'সমস্যা'}</span></div></li>);
    } else if (r.result in st.k) st.k[r.result as keyof typeof K]++;
  };
  const processOne = async (it: Item) => {
    if (!(it.price > 0)) { handle(it, [], { result: 'error', message: 'দাম নেই — বাদ দেওয়া হলো' }); return; }
    if (it.exists && opts().existing === 'skip') { handle(it, [], { result: 'exists' }); return; }
    const ids = it.exists ? [] : await copyImages(it);
    if (it.images.length && !ids.length && !it.exists) it._noPics = true;
    try { handle(it, ids, await save(it, ids)); } catch (e) {
      // one retry after a short wait (network blip)
      await sleep(2500);
      try { handle(it, ids, await save(it, ids)); } catch { handle(it, ids, { result: 'error', message: (e as Error).message || 'সেভ হয়নি' }); }
    }
  };
  const pauseBtn = $<HTMLButtonElement>('[data-imp-pause]', imp)!;
  pauseBtn.addEventListener('click', () => {
    st.paused = !st.paused;
    pauseBtn.textContent = st.paused ? '▶ আবার চালু করুন' : '⏸ থামান';
    $('[data-imp-warn]', imp)!.textContent = st.paused ? '⏸ থামানো আছে। "আবার চালু করুন" চাপলে যেখানে থেমেছিল সেখান থেকে চলবে।' : '⏳ কাজ চলার সময় এই পেজটা বন্ধ করবেন না।';
  });
  unloadGuard(() => st.running);

  $('[data-imp-start]', imp)?.addEventListener('click', async () => {
    if (st.running) return;
    const o = opts();
    if (o.cat_mode === 'one' && !o.category_id && !confirm('কোনো ক্যাটাগরি বাছা হয়নি — সব পণ্য ক্যাটাগরি ছাড়া আসবে। চালিয়ে যাবেন?')) return;
    st.running = true;
    st.paused = false;
    st.done = 0;
    st.total = st.items.length;
    for (const k of Object.keys(st.k) as (keyof typeof K)[]) st.k[k] = 0;
    paint(logList);
    $('[data-imp-log-title]', imp)!.hidden = true;
    $('[data-imp-done]', imp)!.hidden = true;
    pauseBtn.hidden = false;
    for (const s of $all('[data-imp-step="1"], [data-imp-step="2"]', imp)) s.hidden = true;
    $('[data-imp-step="3"]', imp)!.hidden = false;
    draw();
    await workers(st.items, 3, () => st.paused, async (it) => {
      try { await processOne(it); } catch (e) { handle(it, [], { result: 'error', message: (e as Error).message }); }
      st.done++;
      draw();
    });
    st.running = false;
    pauseBtn.hidden = true;
    $('[data-imp-done]', imp)!.hidden = false;
    const noPics = st.items.filter((x) => x._noPics).length;
    paint($('[data-imp-warn]', imp), `✅ আমদানি শেষ! ${bn(st.k.added)}টি নতুন পণ্য যোগ হয়েছে${st.k.updated ? `, ${bn(st.k.updated)}টি আপডেট হয়েছে` : ''}।`,
      noPics ? <><br />⚠️ {bn(noPics)}টি পণ্যের ছবি ওই সাইট থেকে আনা যায়নি — পণ্যগুলো খুলে হাতে ছবি দিন।</> : null);
    toast('আমদানি শেষ');
  });

  // import page opened from market research with a product link
  const impUrl = $<HTMLInputElement>('[data-imp-url]');
  const qs = new URLSearchParams(location.search);
  const pre = qs.get('url');
  if (impUrl && pre && /^https?:\/\//.test(pre)) {
    impUrl.value = pre;
    // came from "➕ যোগ করুন": start reading straight away
    if (qs.get('back')) setTimeout(() => $('[data-imp-read="link"]')?.click(), 50);
  }
}

// ---------- more pictures from the old site (each product's own page) ----------
type Pics = { id?: number; name?: string; sku?: string; thumb?: string; pics?: number; link?: string; main?: string };
type Task = { kind: 'new'; item: Item } | { kind: 'link'; link: string } | { kind: 'pics'; p: Pics };
function morePictures(mp: HTMLElement): void {
  const status = $('[data-mp-status]', mp)!;
  const say = (t: Node | string, bad = false) => { status.hidden = !t; paint(status, t); status.classList.toggle('warn', bad); };
  const K = { added: 0, done: 0, pics: 0, none: 0, error: 0 };
  const st = { list: [] as Task[], max: 12, running: false, paused: false, done: 0, k: K };
  const post = <T,>(url: string, body: unknown) => postJSON<T>(url, body);
  const draw = () => {
    for (const [k, n] of Object.entries(st.k)) { const el = $(`[data-mp-k="${k}"]`, mp); if (el) el.textContent = bn(n); }
    $('[data-mp-bar]', mp)!.style.width = `${st.list.length ? Math.round((st.done * 100) / st.list.length) : 0}%`;
    $('[data-mp-count]', mp)!.textContent = `${bn(st.done)} / ${bn(st.list.length)} টি কাজ শেষ`;
  };
  const logList = $('[data-mp-log]', mp)!;
  const log = (p: Pics, cls: string, text: Node | string) => {
    $('[data-mp-log-title]', mp)!.hidden = false;
    const name = p.id ? <a href={`/admin/products/${p.id}`} target="_blank" rel="noopener"><b>{p.name}</b></a>
      : p.link ? <a href={p.link} target="_blank" rel="noopener noreferrer"><b>{p.name || p.link}</b></a> : <b>{p.name}</b>;
    const li = (
      <li className={`dup-item mp-row ${cls}`}><span className="dup-thumb">{p.thumb ? <img src={p.thumb} alt="" /> : <span>📦</span>}</span>
        <div className="dup-info">{name}{p.sku ? <>{' '}<span className="small muted">SKU {bn(p.sku)}</span></> : null}<span className="dup-why">{text}</span></div></li>
    );
    if (cls === 'is-ok') logList.prepend(li); else logList.appendChild(li);
  };

  // 1. which products
  const planBtn = $<HTMLButtonElement>('[data-mp-plan]', mp)!;
  planBtn.addEventListener('click', async () => {
    const url = ($<HTMLInputElement>('[data-mp-feed]', mp)?.value || '').trim();
    const addNew = !!$<HTMLInputElement>('[name=mp_new]', mp)?.checked;
    if (!url) { say('ফিড লিংক দিন।', true); return; }
    planBtn.disabled = true;
    say('⏳ ফিড আর পুরোনো সাইটের পণ্যের তালিকা পড়া হচ্ছে… (এক মিনিট লাগতে পারে)');
    try {
      const j = await post<PlanAnswer>('/admin/api/morepics/plan', { url, max: $<HTMLInputElement>('[data-mp-max]', mp)?.value });
      planBtn.disabled = false;
      st.max = j.max;
      const missing: Item[] = j.missing || [];
      const extra: string[] = j.extra || [];
      const trash: { title: string }[] = j.inTrash || [];
      // new products first (the most important), then pages only the sitemap knows, then more pictures
      st.list = [
        ...(addNew ? [...missing.map((it): Task => ({ kind: 'new', item: it })), ...extra.map((u): Task => ({ kind: 'link', link: u }))] : []),
        ...j.products.map((p): Task => ({ kind: 'pics', p })),
      ];
      say(<>✅ পুরোনো সাইটে মোট <b>{bn(j.oldTotal)}টি</b> পণ্য পাওয়া গেছে (ফিডে {bn(j.feedItems)}টি{extra.length ? `, ফিডের বাইরে সাইটে আরও ${bn(extra.length)}টি` : ''})।<br />
        এই দোকানে আছে {bn(j.matched)}টি{j.full ? ` (${bn(j.full)}টিতে আগে থেকেই সব ছবি আছে)` : ''}।{' '}
        {missing.length ? <><b>{bn(missing.length)}টি নেই</b> — {addNew ? 'এগুলো যোগ করা হবে।' : 'এগুলো যোগ করতে উপরের টিক দিন।'}</> : 'ফিডের সব পণ্যই দোকানে আছে।'}
        {extra.length ? ` ফিডের বাইরের ${bn(extra.length)}টি পেজ খুলে দেখা হবে — দোকানে না থাকলে যোগ হবে।` : ''}
        {!j.sitemapRead ? <><br /><span className="small">(পুরোনো সাইটের sitemap পড়া যায়নি — শুধু ফিডের পণ্য ধরা হয়েছে।)</span></> : null}
        {trash.length ? <><br />🗑️ {bn(trash.length)}টি পণ্য আপনি মুছে ফেলেছিলেন (রিসাইকেল বিনে আছে), তাই আবার আনা হবে না — চাইলে <a href="/admin/trash">রিসাইকেল বিন</a> থেকে ফেরত আনুন।</> : null}</>);
      const tl = $('[data-mp-trash]', mp)!;
      paint(tl, trash.map((x) => <li>🗑️ {x.title}</li>));
      tl.hidden = !trash.length;
      $('[data-mp-found]', mp)!.textContent = `${bn(st.list.length)}টি কাজ`;
      $('[data-mp-step="2"]', mp)!.hidden = false;
      $<HTMLButtonElement>('[data-mp-start]', mp)!.disabled = !st.list.length;
      st.done = 0;
      draw();
    } catch (e) { planBtn.disabled = false; say(`⚠️ ${(e as Error).message}`, true); }
  });

  // the same picture written two ways (…/a.webp and …/a.webp?w=600) counts once
  const uniq = (list: string[]) => {
    const seen = new Set<string>();
    return list.filter((u) => { const k = String(u || '').split('?')[0].toLowerCase(); if (!u || seen.has(k)) return false; seen.add(k); return true; });
  };
  // more pictures for a product already in the shop
  const one = async (p: Pics) => {
    const f = await post<FindAnswer>('/admin/api/morepics/find', { link: p.link, main: p.main });
    if (f.error) { st.k.error++; log(p, 'is-warn', `⚠️ ${f.error}`); return; }
    if (!f.confirmed) { st.k.error++; log(p, 'is-warn', `⚠️ ${f.note}`); return; }
    const pics = uniq(f.images || []).slice(0, st.max + 3); // the whole old gallery (a few spare in case some are the same photo)
    if (!pics.length) { st.k.none++; return; }
    const ids = await copyAll(pics);
    if (!ids.length) { st.k.error++; log(p, 'is-warn', '⚠️ ছবিগুলো আনা যায়নি'); return; }
    const r = await post<AttachAnswer>('/admin/api/morepics/attach', { product_id: p.id, ids, max: st.max });
    if (r.added) {
      st.k.done++;
      st.k.pics += r.added;
      log(p, 'is-ok', `✅ ${bn(r.added)}টি নতুন ছবি — এখন মোট ${bn(r.total)}টি`);
    } else st.k.none++;
  };
  // a product the shop doesn't have yet: saved with its main picture, then the rest of its gallery is added
  // the same careful way as for the old products (same photo never twice, never another product's)
  const addNew = async (it: Item) => {
    const row: Pics = { name: it.title, link: it.link };
    const feedPics = uniq(it.images || []);
    const f: FindAnswer = it.link ? await post<FindAnswer>('/admin/api/morepics/find', { link: it.link, main: feedPics[0] || '' }).catch(() => ({})) : {};
    const foundPics = f.confirmed ? uniq(f.images || []) : [];
    const mainUrl = feedPics[0] || foundPics[0] || '';
    const rest = uniq(foundPics.concat(feedPics.slice(1))).filter((u) => u.split('?')[0] !== mainUrl.split('?')[0]);
    const mainIds = await copyAll(mainUrl ? [mainUrl] : []);
    const r = await post<SaveAnswer>('/admin/api/import/save', { item: it, images: mainIds, allow_duplicate: 1,
      options: { active: true, hide_no_image: true, cat_mode: 'auto', default_stock: 10, existing: 'skip' } });
    if (r.result === 'exists') { st.k.none++; return; }
    if (r.result === 'duplicate') {
      st.k.error++;
      const m = r.matches?.[0];
      log(row, 'is-warn', <>⚠️ দোকানে একই রকম পণ্য আছে, তাই যোগ হয়নি{m ? <> (মিলেছে: <a href={`/admin/products/${m.id}`} target="_blank">{m.name}</a>)</> : null} — দরকার হলে নিজে যোগ করুন</>);
      return;
    }
    if (r.result !== 'added') { st.k.error++; log(row, 'is-warn', `⚠️ ${r.message || 'যোগ হয়নি'}`); return; }
    st.k.added++;
    row.id = r.id;
    row.sku = r.sku;
    let a: Pick<AttachAnswer, 'added' | 'total'> = { added: 0, total: mainIds.length };
    if (rest.length) {
      const ids = await copyAll(rest.slice(0, st.max + 3));
      if (ids.length) a = await post<AttachAnswer>('/admin/api/morepics/attach', { product_id: r.id, ids, max: st.max });
    }
    const total = a.total || mainIds.length;
    st.k.pics += total;
    log(row, 'is-ok', `🆕 নতুন পণ্য যোগ হয়েছে — ${bn(total)}টি ছবিসহ${total || r.active ? '' : ' (ছবি না থাকায় দোকানে লুকানো)'}`);
  };
  // a page only the old site's sitemap knows: read it, then add it or fill its pictures
  const fromLink = async (link: string) => {
    const r = await post<PageAnswer>('/admin/api/morepics/page', { link });
    if (r.error) { st.k.error++; log({ name: link, link }, 'is-warn', `⚠️ ${r.error}`); return; }
    if (r.trashed) { st.k.none++; log({ name: r.item.title, link }, 'is-skip', '🗑️ রিসাইকেল বিনে আছে — আনা হয়নি'); return; }
    if (r.exists) {
      if (r.exists.pics >= st.max) { st.k.none++; return; }
      await one({ id: r.exists.id, name: r.exists.name, sku: r.exists.sku, thumb: r.exists.thumb, pics: r.exists.pics, link: r.item.link || link, main: (r.item.images || [])[0] || '' });
      return;
    }
    await addNew(r.item);
  };
  const run = (t: Task) => (t.kind === 'new' ? addNew(t.item) : t.kind === 'link' ? fromLink(t.link) : one(t.p));
  const label = (t: Task): Pics => (t.kind === 'pics' ? t.p : t.kind === 'new' ? { name: t.item.title, link: t.item.link } : { name: t.link, link: t.link });
  const pauseBtn = $<HTMLButtonElement>('[data-mp-pause]', mp)!;
  pauseBtn.addEventListener('click', () => { st.paused = !st.paused; pauseBtn.textContent = st.paused ? '▶ আবার চালু করুন' : '⏸ থামান'; });
  unloadGuard(() => st.running);
  const startBtn = $<HTMLButtonElement>('[data-mp-start]', mp)!;
  startBtn.addEventListener('click', async () => {
    if (st.running || !st.list.length) return;
    st.running = true;
    st.paused = false;
    st.done = 0;
    for (const k of Object.keys(st.k) as (keyof typeof K)[]) st.k[k] = 0;
    paint(logList);
    $('[data-mp-log-title]', mp)!.hidden = true;
    startBtn.hidden = true;
    pauseBtn.hidden = false;
    $('[data-mp-done]', mp)!.hidden = true;
    $('[data-mp-step="1"]', mp)!.hidden = true;
    draw();
    await workers(st.list, 2, () => st.paused, async (t) => {
      try { await run(t); } catch (e) {
        // one retry after a short wait (network blip)
        await sleep(2500);
        try { await run(t); } catch { st.k.error++; log(label(t), 'is-warn', `⚠️ ${(e as Error).message || 'সমস্যা'}`); }
      }
      st.done++;
      draw();
    });
    st.running = false;
    pauseBtn.hidden = true;
    $('[data-mp-done]', mp)!.hidden = false;
    $('[data-mp-warn]', mp)!.textContent = `✅ শেষ! ${st.k.added ? `${bn(st.k.added)}টি নতুন পণ্য যোগ হয়েছে। ` : ''}${st.k.done ? `${bn(st.k.done)}টি আগের পণ্যে নতুন ছবি বসেছে। ` : ''}মোট ${bn(st.k.pics)}টি ছবি এসেছে।`
      + (st.k.none ? ` ${bn(st.k.none)}টি পণ্যে আগে থেকেই পুরোনো সাইটের সব ছবি ছিল (নতুন কিছু লাগেনি)।` : '')
      + (st.k.error ? ` ${bn(st.k.error)}টিতে সমস্যা — নিচের তালিকায় দেখুন, পরে আবার চালালে বাকিগুলো হবে।` : '');
  });

  // test with one product page (nothing saved)
  const testBtn = $<HTMLButtonElement>('[data-mp-test]', mp)!;
  testBtn.addEventListener('click', async () => {
    const out = $('[data-mp-test-out]', mp)!;
    const link = ($<HTMLInputElement>('[data-mp-test-url]', mp)?.value || '').trim();
    if (!link) return;
    testBtn.disabled = true;
    paint(out, <p className="small muted">⏳ পেজ পড়া হচ্ছে…</p>);
    try {
      const f = await post<FindAnswer>('/admin/api/morepics/find', { link });
      testBtn.disabled = false;
      if (f.error) { paint(out, <p className="warn">⚠️ {f.error}</p>); return; }
      const imgs: string[] = f.images || [];
      paint(out, <p><b>{imgs.length ? `✅ ${bn(imgs.length)}টি ছবি পাওয়া গেছে` : 'এই পেজে বাড়তি কোনো ছবি পাওয়া যায়নি'}</b>
        {imgs.length ? <>{' '}<span className="small muted">(মূল ছবিসহ — আসল কাজের সময় মূল ছবি বাদ দিয়ে বাকিগুলো বসবে)</span></> : null}</p>,
      <div className="mp-pics">{imgs.map((u) => <img src={`/admin/api/import/image?u=${encodeURIComponent(u)}`} alt="" loading="lazy" />)}</div>);
    } catch (e) { testBtn.disabled = false; paint(out, <p className="warn">⚠️ {(e as Error).message}</p>); }
  });
}

export function startImporter(): void {
  try {
    const imp = $('[data-import]');
    if (imp) importer(imp);
    const mp = $('[data-morepics]');
    if (mp) morePictures(mp);
  } catch (e) { console.error('সবমিলবে admin: import could not start', e); }
}
