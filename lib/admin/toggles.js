'use strict';
// On/off switches in admin lists (blog posts, pages, staff, suppliers). Saves instantly; the list
// row fades when off. Same behaviour as the product list switch.
const { int } = require('../util');
const db = require('../db');

const KINDS = {
  blog: { perm: 'blog', entity: 'blog', sql: `UPDATE blog_posts SET status=CASE WHEN $2 THEN 'published' ELSE 'draft' END,
    published_at=CASE WHEN $2 THEN coalesce(published_at, now()) ELSE published_at END, updated_at=now() WHERE id=$1 RETURNING title AS name` },
  page: { perm: 'design', entity: 'page', sql: 'UPDATE pages SET active=$2, updated_at=now() WHERE id=$1 RETURNING title AS name' },
  staff: { perm: 'owner', entity: 'staff', sql: `UPDATE staff SET active=$2 WHERE id=$1 AND role<>'owner' RETURNING name` },
  supplier: { perm: 'inventory', entity: 'supplier', sql: 'UPDATE suppliers SET active=$2 WHERE id=$1 RETURNING name' },
  coupon: { perm: 'marketing', entity: 'coupon', sql: 'UPDATE coupons SET active=$2 WHERE id=$1 RETURNING code AS name' },
  research: { perm: 'owner', entity: 'research_source', sql: 'UPDATE research_sources SET active=$2 WHERE id=$1 RETURNING name' },
};

async function toggle(ctx, m) {
  const K = KINDS[m[1]];
  const id = int(m[2]);
  if (!K || !ctx.can(K.perm)) return ctx.json(ctx.res, 403, { error: 'অনুমতি নেই।' });
  if (m[1] === 'staff' && id === ctx.user.id) return ctx.json(ctx.res, 400, { error: 'নিজেকে বন্ধ করতে পারবেন না।' });
  const b = await ctx.body();
  const on = !!b.active && b.active !== '0';
  const r = await db.one(K.sql, [id, on]);
  if (!r) return ctx.json(ctx.res, 404, { error: 'পাওয়া যায়নি।' });
  await ctx.log(on ? 'enable' : 'disable', K.entity, id, `${on ? 'চালু' : 'বন্ধ'}: ${r.name}`);
  if (String(ctx.req.headers.accept || '').includes('application/json')) return ctx.json(ctx.res, 200, { ok: true, active: on });
  return ctx.redirect(ctx.res, ctx.req.headers.referer || '/admin');
}

module.exports = { routes: [{ method: 'POST', path: /^\/admin\/toggle\/(blog|page|staff|supplier|coupon|research)\/(\d+)$/, handler: toggle }] };
