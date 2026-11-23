// 🎬 Video posts (owner, 2026-11-23: "make it so you can put videos up — one now, one at a set time").
// A reel goes to the Facebook page (Reels API) and Instagram (REELS) from a public video link — the shop's own
// videos live in public/videos (https://shobmilbe.com/videos/…). Facebook and Instagram fetch the file themselves,
// so the server only sends a few small requests. The shop's 5-minute timer posts every reel whose time has come.
// Each side is tried once; an error is kept on the row and "Try again" in the admin clears it.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as db from '../db';
import { graph } from './autopost';
import type { Settings, Caught } from '../types';

const GRAPH_VER = 'v21.0';

export type VideoPost = {
  id: number; video_url: string; caption: string; post_at: Date; to_fb: boolean; to_ig: boolean;
  fb_id: string | null; fb_error: string | null; ig_container: string | null; ig_id: string | null; ig_error: string | null;
  done: boolean; created_at: Date;
};

/** the shop's own videos (public/videos), newest first */
export function ownVideos(): { file: string; url: string; mb: number }[] {
  const dir = path.join(process.cwd(), 'public', 'videos');
  try {
    return fs.readdirSync(dir).filter((f) => /^[\w.-]+\.mp4$/i.test(f))
      .map((f) => { const st = fs.statSync(path.join(dir, f)); return { file: f, url: `/videos/${f}`, mb: Math.round(st.size / 1048576 * 10) / 10, t: st.mtimeMs }; })
      .sort((a, b) => b.t - a.t).map(({ file, url, mb }) => ({ file, url, mb }));
  } catch { return []; }
}

export async function list(limit = 30) {
  return db.q<VideoPost>('SELECT * FROM video_posts ORDER BY (NOT done) DESC, post_at DESC LIMIT $1', [limit]);
}

export async function add(v: { video_url: string; caption: string; post_at: Date; to_fb: boolean; to_ig: boolean; staff_id?: number | null }) {
  if (!/^https:\/\/\S+\.mp4(\?\S*)?$/i.test(v.video_url)) throw new Error('Video link must be a public https link to an .mp4 file.');
  if (!v.to_fb && !v.to_ig) throw new Error('Pick Facebook, Instagram or both.');
  if (Number.isNaN(v.post_at.getTime())) throw new Error('The time is not valid.');
  return db.one<{ id: number }>(`INSERT INTO video_posts(video_url, caption, post_at, to_fb, to_ig, staff_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [v.video_url, v.caption.slice(0, 2150), v.post_at, v.to_fb, v.to_ig, v.staff_id ?? null]);
}

/** delete one that has not gone out anywhere yet */
export async function remove(id: number) {
  await db.q('DELETE FROM video_posts WHERE id=$1 AND fb_id IS NULL AND ig_id IS NULL', [id]);
}

/** clear the errors so the timer tries the failed side again */
export async function retry(id: number) {
  await db.q(`UPDATE video_posts SET fb_error=NULL, ig_error=NULL, ig_container=CASE WHEN ig_error IS NULL THEN ig_container END, done=false WHERE id=$1`, [id]);
}

/** Facebook page reel: start → Facebook fetches the file from the link → publish with the caption */
async function postFacebookReel(v: VideoPost, s: Settings): Promise<string> {
  const token = s.autopost_page_token, page = s.autopost_page_id;
  const start = await graph<{ video_id?: string }>(`${page}/video_reels`, { method: 'POST', token, params: { upload_phase: 'start' } });
  if (!start.video_id) throw new Error('Facebook did not start the upload.');
  const r = await fetch(`https://rupload.facebook.com/video-upload/${GRAPH_VER}/${start.video_id}`, {
    method: 'POST', headers: { Authorization: `OAuth ${token}`, file_url: v.video_url }, signal: AbortSignal.timeout(60000),
  });
  const up = await r.json().catch(() => ({})) as { success?: boolean; debug_info?: { message?: string } };
  if (!r.ok || !up.success) throw new Error('Facebook could not fetch the video: ' + (up.debug_info?.message || `HTTP ${r.status}`));
  await graph(`${page}/video_reels`, { method: 'POST', token, params: { upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description: v.caption } });
  return start.video_id;
}

/** Instagram reel: a container (Instagram fetches the video) → when it says FINISHED, publish. Can take a few minutes,
 *  so the container id is kept and later rounds of the timer finish the job. */
async function stepInstagram(v: VideoPost, s: Settings): Promise<{ id?: string; waiting?: boolean }> {
  const token = s.autopost_page_token, ig = s.autopost_ig_id;
  let box = v.ig_container;
  if (!box) {
    const c = await graph(`${ig}/media`, { method: 'POST', token, params: { media_type: 'REELS', video_url: v.video_url, caption: v.caption, share_to_feed: 'true' } });
    box = String(c.id || '');
    if (!box) throw new Error('Instagram did not accept the video.');
    await db.q('UPDATE video_posts SET ig_container=$2 WHERE id=$1', [v.id, box]);
  }
  for (let i = 0; i < 6; i++) {
    const st = await graph<{ status_code?: string; status?: string }>(box, { token, params: { fields: 'status_code,status' } });
    if (st.status_code === 'FINISHED') {
      const p = await graph(`${ig}/media_publish`, { method: 'POST', token, params: { creation_id: box } });
      return { id: String(p.id || '') };
    }
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error('Instagram could not use the video: ' + (st.status || st.status_code));
    await new Promise((res) => setTimeout(res, 5000));
  }
  return { waiting: true };
}

/** the 5-minute timer: post every reel whose time has come */
export async function tick(s: Settings) {
  if (!s.autopost_page_token || !s.autopost_page_id) return { off: true };
  const due = await db.q<VideoPost>('SELECT * FROM video_posts WHERE NOT done AND post_at <= now() ORDER BY post_at LIMIT 3').catch(() => [] as VideoPost[]);
  const out: string[] = [];
  for (const v of due) {
    if (v.to_fb && !v.fb_id && !v.fb_error) {
      try { v.fb_id = await postFacebookReel(v, s); await db.q('UPDATE video_posts SET fb_id=$2 WHERE id=$1', [v.id, v.fb_id]); out.push(`#${v.id} facebook`); } catch (caught) { const e = caught as Caught;
        v.fb_error = String(e.message).slice(0, 400); await db.q('UPDATE video_posts SET fb_error=$2 WHERE id=$1', [v.id, v.fb_error]);
        await db.logIntegration('facebook-video', 'post', false, v.fb_error, v.video_url);
      }
    }
    const igOn = v.to_ig && !!s.autopost_ig_id;
    if (igOn && !v.ig_id && !v.ig_error) {
      try { const r = await stepInstagram(v, s); if (r.id) { v.ig_id = r.id; await db.q('UPDATE video_posts SET ig_id=$2 WHERE id=$1', [v.id, r.id]); out.push(`#${v.id} instagram`); } } catch (caught) { const e = caught as Caught;
        v.ig_error = String(e.message).slice(0, 400); await db.q('UPDATE video_posts SET ig_error=$2 WHERE id=$1', [v.id, v.ig_error]);
        await db.logIntegration('instagram-video', 'post', false, v.ig_error, v.video_url);
      }
    }
    const fbDone = !v.to_fb || !!v.fb_id || !!v.fb_error;
    const igDone = !igOn || !!v.ig_id || !!v.ig_error;
    if (fbDone && igDone) await db.q('UPDATE video_posts SET done=true WHERE id=$1', [v.id]);
  }
  return { posted: out };
}
