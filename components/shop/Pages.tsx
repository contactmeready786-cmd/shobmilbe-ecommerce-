// ⚛️ Simple shop pages: order tracking, "page not found", the owner's own pages (About, Return policy …) and the blog.
// Moved from lib/views/shop.ts (2026-10-17); same HTML as before.
import { RawHtml } from '../../lib/react/render';
import { fmtDate } from '../../lib/util';
import * as md from '../../lib/views/md';
import type { Loose } from '../../lib/types';

export function TrackPage({ error, code, phone }: { error?: string; code?: string; phone?: string }) {
  return (
    <div className="wrap section narrow">
      <h1>অর্ডার ট্র্যাক করুন</h1>
      <form className="form panel" method="get" action="/track">
        <p className="muted">অর্ডার করার পর যে নম্বর পেয়েছিলেন (যেমন SM7K2P9Q) আর আপনার মোবাইল নম্বর দিন।</p>
        <div className="field"><label htmlFor="code">অর্ডার নম্বর</label><input id="code" name="code" required defaultValue={code || ''} autoCapitalize="characters" placeholder="SM…" /></div>
        <div className="field"><label htmlFor="tphone">মোবাইল নম্বর</label><input id="tphone" name="phone" required inputMode="tel" defaultValue={phone || ''} placeholder="01XXXXXXXXX" /></div>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="btn btn-block" type="submit">অবস্থা দেখুন</button>
      </form>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="wrap section narrow center">
      <h1>পেজটি পাওয়া যায়নি</h1>
      <p className="muted">লিংকটি ভুল হতে পারে, অথবা পণ্যটি সরিয়ে ফেলা হয়েছে।</p>
      <p><a className="btn" href="/">হোমে ফিরে যান</a> <a className="btn btn-ghost" href="/products">সব পণ্য</a></p>
    </div>
  );
}

export function StaticPage({ page }: { page: Loose }) {
  return (
    <div className="wrap section narrow"><nav className="crumbs"><a href="/">হোম</a> / <span>{page.title}</span></nav>
      <article className="post rich"><h1>{page.title}</h1><RawHtml html={md.render(page.content)} /></article></div>
  );
}

// ---------------------------------------------------------------- blog
export function PostCard({ p }: { p: Loose }) {
  return (
    <article className="post-card"><a href={`/blog/${p.slug}`} className="post-pic">{p.cover_id ? <img src={`/media/${p.cover_id}/t`} alt="" loading="lazy" draggable="false" /> : <span>📝</span>}</a>
      <div><span className="small muted">{p.category_name || ''} · {fmtDate(p.published_at, false)}</span><h3><a href={`/blog/${p.slug}`}>{p.title}</a></h3><p>{p.excerpt}</p></div></article>
  );
}

export function BlogList({ posts, categories, category }: { posts: Loose[]; categories: Loose[]; category: Loose }) {
  return (
    <div className="wrap section">
      <nav className="crumbs"><a href="/">হোম</a> / <a href="/blog">ব্লগ</a>{category ? <> / <span>{category.name}</span></> : null}</nav>
      <h1>{category ? category.name : 'ব্লগ ও টিপস'}</h1>
      {categories.length ? <div className="chips"><a className={`chip ${!category ? 'on' : ''}`} href="/blog">সব</a>{categories.map((c) => <a key={c.id} className={`chip ${category && category.id === c.id ? 'on' : ''}`} href={`/blog/category/${c.slug}`}>{c.name}</a>)}</div> : null}
      {posts.length ? <div className="post-grid">{posts.map((p) => <PostCard key={p.id ?? p.slug} p={p} />)}</div> : <div className="empty"><p>এখনো কোনো লেখা নেই।</p></div>}
    </div>
  );
}

export function BlogPost({ post, contentHtml, related }: { post: Loose; contentHtml: string; related: Loose[] }) {
  return (
    <div className="wrap section narrow">
      <nav className="crumbs"><a href="/">হোম</a> / <a href="/blog">ব্লগ</a>{post.category_slug ? <> / <a href={`/blog/category/${post.category_slug}`}>{post.category_name}</a></> : null}</nav>
      <article className="post rich">
        <h1>{post.title}</h1>
        <p className="muted small">{fmtDate(post.published_at, false)}{post.author_name ? ` · ${post.author_name}` : ''}</p>
        {post.cover_id ? <img className="post-cover" src={`/media/${post.cover_id}`} alt="" draggable="false" /> : null}
        <RawHtml html={contentHtml} />
      </article>
      {related.length ? <><h2>আরও পড়ুন</h2><div className="post-grid">{related.map((p) => <PostCard key={p.id ?? p.slug} p={p} />)}</div></> : null}
    </div>
  );
}
