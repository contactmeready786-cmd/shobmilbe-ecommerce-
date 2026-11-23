// Admin → Marketing → Social media auto post → 🎬 Video posts (owner, 2026-11-23; lib/services/videopost.ts).
// Pick one of the shop's videos (public/videos) or paste a public .mp4 link, write the caption, post it now or set a
// time — the shop's 5-minute timer puts it on the Facebook page and Instagram as a reel. Captions are customer
// text, so they stay Bangla (a textarea is never changed by the English admin).
import { Val, attrValue, jsxList } from '../react/html';
import { int, fmtDate } from '../util';
import * as ui from './ui';
import * as V from '../services/videopost';
import type { AdminCtx } from '../types';

const BASE = '/admin/marketing/videos';

/** "2026-11-23T15:30" typed in Bangladesh time → the moment it means */
function dhakaTime(local: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return new Date(NaN);
  return new Date(`${local}:00+06:00`);
}

function state(v: V.VideoPost, side: 'fb' | 'ig') {
  const on = side === 'fb' ? v.to_fb : v.to_ig;
  const id = side === 'fb' ? v.fb_id : v.ig_id;
  const err = side === 'fb' ? v.fb_error : v.ig_error;
  if (!on) return <span className="muted">—</span>;
  if (id) return <span className="pill ok">✅ Posted</span>;
  if (err) return <span className="pill bad" title={attrValue(err)}>❌ Failed</span>;
  if (side === 'ig' && v.ig_container) return <span className="pill warn">⏳ Instagram is processing</span>;
  return <span className="pill">🕒 Waiting</span>;
}

async function handle(ctx: AdminCtx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body<'action' | 'id' | 'video' | 'link' | 'caption' | 'when' | 'at' | 'fb' | 'ig'>();
    try {
      if (b.action === 'delete') { await V.remove(int(b.id)); return ctx.back(BASE, 'saved'); }
      if (b.action === 'retry') { await V.retry(int(b.id)); return ctx.back(`${BASE}?info=${encodeURIComponent('It will be tried again within 5 minutes.')}`); }
      const site = String(ctx.settings.site_url || 'https://shobmilbe.com').replace(/\/+$/, '');
      const url = String(b.link || '').trim() || (b.video ? `${site}${String(b.video)}` : '');
      const at = b.when === 'later' ? dhakaTime(String(b.at || '')) : new Date();
      const r = await V.add({ video_url: url, caption: String(b.caption || '').trim(), post_at: at, to_fb: b.fb === '1', to_ig: b.ig === '1', staff_id: ctx.user.id });
      await ctx.log('create', 'marketing', r ? r.id : null, `Video post ${b.when === 'later' ? 'set for ' + fmtDate(at) : 'now'}: ${url}`);
      return ctx.back(`${BASE}?info=${encodeURIComponent(b.when === 'later' ? 'Saved — it goes out at the time you set.' : 'Saved — it goes out within 5 minutes.')}`);
    } catch (e) {
      return ctx.fail(BASE, (e as Error).message || 'Could not save.');
    }
  }
  const [rows, vids] = [await V.list(), V.ownVideos()];
  const s = ctx.settings;
  const connected = !!(s.autopost_page_token && s.autopost_page_id);
  const body = <>
    <div className="title-row"><h1>🎬 Video posts <small>reels on the Facebook page and Instagram</small></h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href={attrValue(BASE)}>🔄 Refresh</a></div></div>
    {ui.flash(ctx.flash)}
    {(connected ? null : <section className="panel"><p>Facebook page is not connected. Connect it once on <a href="/admin/marketing/auto">Facebook, Instagram &amp; Telegram</a>.</p></section>)}
    <section className="panel">
      <h2>New video post</h2>
      <form method="post" action={attrValue(BASE)} className="form-grid">
        <input type="hidden" name="action" defaultValue="add" />
        {ui.field('Shop video', ui.select('video', [['', '— pick a video —'], ...vids.map((v) => [v.url, `${v.file} (${v.mb} MB)`])], vids[0]?.url || ''), 'Videos made for the shop. Or paste a link below.')}
        {ui.field('Or video link (.mp4)', ui.input('link', '', { placeholder: 'https://…/video.mp4', maxlength: 500 }))}
        {ui.field('Caption', <textarea name="caption" rows={6} maxLength={2150} className="gp-text" placeholder="লেখা, দাম, অর্ডারের লিংক, হ্যাশট্যাগ" />)}
        {ui.field('When', <div className="row-actions">
          <label><input type="radio" name="when" value="now" defaultChecked /> Now</label>
          <label><input type="radio" name="when" value="later" /> At</label>
          <input type="datetime-local" name="at" aria-label="Time (Bangladesh)" />
          <span className="small muted">Bangladesh time</span>
        </div>)}
        {ui.field('Post to', <div className="row-actions">{ui.check('fb', true, 'Facebook page')}{' '}{ui.check('ig', !!s.autopost_ig_id, 'Instagram')}</div>)}
        <p><button className="btn">Save</button></p>
      </form>
    </section>
    <section className="panel table-wrap"><h2>Posts</h2>
      {(rows.length ? <table className="table compact"><thead><tr><th>Video</th><th>Caption</th><th>Time</th><th>Facebook</th><th>Instagram</th><th></th></tr></thead><tbody>
        {jsxList(rows.map((v) => <tr>
          <td className="small"><a href={attrValue(v.video_url)} target="_blank" rel="noopener"><Val v={v.video_url.split('/').pop()} /></a></td>
          <td className="small"><textarea className="gp-text" readOnly rows={2} defaultValue={v.caption} aria-label="Caption" /></td>
          <td className="small">{fmtDate(v.post_at)}</td>
          <td>{state(v, 'fb')}</td>
          <td>{state(v, 'ig')}</td>
          <td><div className="row-actions">
            {((v.fb_error || v.ig_error) ? <form method="post" action={attrValue(BASE)}><input type="hidden" name="action" defaultValue="retry" /><input type="hidden" name="id" defaultValue={attrValue(v.id)} /><button className="btn btn-sm btn-ghost">Try again</button></form> : null)}
            {(!v.fb_id && !v.ig_id ? <form method="post" action={attrValue(BASE)} data-confirm="Delete this video post?"><input type="hidden" name="action" defaultValue="delete" /><input type="hidden" name="id" defaultValue={attrValue(v.id)} /><button className="btn btn-sm btn-ghost">Delete</button></form> : null)}
          </div></td>
        </tr>))}
      </tbody></table> : <p className="muted">No video posts yet.</p>)}
    </section>
  </>;
  return ctx.page('Video posts', body, 'videos');
}

export const routes = [{ method: '*', path: BASE, perm: 'marketing', handler: handle }];
