'use strict';
// Staff accounts and what each one may do.
const { q, one } = require('../db');
const { hashPassword, passwordProblem, str, int } = require('../util');

// Every permission a staff member can be given. The owner always has all of them.
// [key, label, hint, group] — for products, stock and customers there are separate see / add / edit / delete ticks.
const PERMISSIONS = [
  ['dashboard', 'ড্যাশবোর্ড ও বিক্রির গ্রাফ', 'বিক্রি আর অর্ডারের সংখ্যা দেখতে পারবে (লাভ শুধু মালিক দেখেন)', 'সাধারণ'],
  ['orders', 'অর্ডার দেখা', 'অর্ডার লিস্ট আর ডিটেইলস দেখতে পারবে', 'অর্ডার'],
  ['orders_edit', 'অর্ডার এডিট ও অবস্থা বদল', 'অর্ডার কনফার্ম/বাতিল, পণ্য-দাম-ঠিকানা এডিট, নতুন অর্ডার তৈরি', 'অর্ডার'],
  ['courier', 'কুরিয়ারে পাঠানো', 'অর্ডার কুরিয়ারে পাঠাতে আর স্ট্যাটাস আপডেট করতে পারবে', 'অর্ডার'],
  ['products_view', 'পণ্য দেখা', 'পণ্য, ক্যাটাগরি আর ব্র্যান্ডের তালিকা দেখতে পারবে, কিছু বদলাতে পারবে না', 'পণ্য'],
  ['products_add', 'নতুন পণ্য যোগ', 'নতুন পণ্য আপলোড, কপি আর আমদানি করতে পারবে', 'পণ্য'],
  ['products', 'পণ্য এডিট', 'দাম, ছবি, বিবরণ, চালু/বন্ধ, বান্ডেল, ক্যাটাগরি আর ব্র্যান্ড বদলাতে পারবে', 'পণ্য'],
  ['products_delete', 'পণ্য মুছে ফেলা', 'পণ্য, ক্যাটাগরি, ব্র্যান্ড মুছতে পারবে (রিসাইকেল বিনে যায়)', 'পণ্য'],
  ['dup_override', 'ডুপ্লিকেট পণ্য তবুও প্রকাশ', 'একই রকম পণ্য আগে থেকে থাকলেও সুইচ চালু করে সেটা প্রকাশ করতে পারবে', 'পণ্য'],
  ['inventory_view', 'স্টক দেখা', 'স্টক, স্টকের ইতিহাস, সাপ্লায়ার আর পারচেজ দেখতে পারবে, কিছু বদলাতে পারবে না', 'স্টক'],
  ['inventory', 'স্টক বদল ও পারচেজ', 'স্টক বাড়ানো/কমানো, নষ্ট মাল, সাপ্লায়ার আর পারচেজ এন্ট্রি (কেনা দাম লিখতে পারবে, পরে দেখতে পারবে না)', 'স্টক'],
  ['customers_view', 'কাস্টমার দেখা', 'কাস্টমারের তথ্য আর অর্ডার ইতিহাস দেখতে পারবে, কিছু বদলাতে পারবে না', 'কাস্টমার'],
  ['customers', 'কাস্টমার এডিট ও ব্লক', 'কাস্টমারের তথ্য, নোট এডিট আর ফ্রড ব্লক করতে পারবে', 'কাস্টমার'],
  ['marketing', 'মার্কেটিং ও কুপন', 'পিক্সেল, SEO, কুপন/অফার, লাইভ চ্যাট', 'মার্কেটিং'],
  ['reviews', 'রিভিউ অনুমোদন', 'কাস্টমারদের রিভিউ দেখানো/লুকানো আর উত্তর দেওয়া', 'মার্কেটিং'],
  ['blog', 'ব্লগ', 'ব্লগ পোস্ট লেখা ও প্রকাশ', 'মার্কেটিং'],
  ['design', 'স্টোর ডিজাইন', 'লোগো, ব্যানার, মেনু, পেজ, হোমপেজ', 'মার্কেটিং'],
  ['accounting', 'হিসাব-নিকাশ', 'আয়-ব্যয় এন্ট্রি, ব্যাংক ব্যালেন্স, ভ্যাট (লাভ-ক্ষতি আর কেনা দাম শুধু মালিক দেখেন)', 'হিসাব ও রিপোর্ট'],
  ['reports', 'রিপোর্ট ও এক্সপোর্ট', 'বিক্রি ও স্টাফ রিপোর্ট, CSV ডাউনলোড', 'হিসাব ও রিপোর্ট'],
  ['settings', 'সেটিংস ও ইন্টিগ্রেশন', 'দোকানের সেটিংস, পেমেন্ট, কুরিয়ার API, ডোমেইন', 'সেটিংস'],
];
const PERMISSION_KEYS = PERMISSIONS.map((p) => p[0]);
// Ready-made roles to fill the checkboxes quickly.
const PRESETS = {
  super_admin: { label: 'সুপার অ্যাডমিন (সব কাজ)', perms: PERMISSION_KEYS.slice() },
  order_manager: { label: 'অর্ডার ম্যানেজার', perms: ['dashboard', 'orders', 'orders_edit', 'courier', 'customers_view', 'customers', 'products_view'] },
  product_manager: { label: 'প্রোডাক্ট ম্যানেজার', perms: ['products_view', 'products_add', 'products', 'inventory_view'] },
  inventory_manager: { label: 'ইনভেন্টরি ম্যানেজার', perms: ['products_view', 'inventory_view', 'inventory'] },
  moderator: { label: 'মডারেটর (শুধু কনফার্ম কল)', perms: ['orders', 'orders_edit', 'customers_view', 'reviews'] },
  marketer: { label: 'মার্কেটার', perms: ['dashboard', 'marketing', 'reviews', 'blog', 'design', 'reports', 'products_view'] },
  accountant: { label: 'হিসাবরক্ষক', perms: ['dashboard', 'orders', 'accounting', 'reports', 'inventory_view'] },
};

// Buying prices, profit and profit-loss are the owner's secret: no staff member can ever get them,
// even if an old account still has the old "see_cost" tick saved.
const OWNER_ONLY = new Set(['see_cost', 'owner']);
function can(user, perm) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  if (OWNER_ONLY.has(perm)) return false;
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

// The finer levels behind a page permission. "products" itself = edit.
const LEVELS = {
  products: { view: 'products_view', add: 'products_add', del: 'products_delete' },
  inventory: { view: 'inventory_view' },
  customers: { view: 'customers_view' },
};
const isDeletePath = (path) => /\/(delete|bulk-delete|remove)$/.test(path);
const isAddPath = (path) => /\/(new|duplicate)$|\/import(\/|$)|\/dup-check$/.test(path);
// May this person use this route? Pages (GET) open with any level; a change needs the matching level.
function routeAllows(user, perm, method, path) {
  if (perm === 'owner') return !!user && user.role === 'owner';
  if (!user) return false;
  if (user.role === 'owner') return true;
  const L = LEVELS[perm];
  const write = method !== 'GET' && method !== 'HEAD';
  if (!L) return can(user, perm);
  if (!write) return [perm, ...Object.values(L)].some((p) => can(user, p));
  if (L.del && isDeletePath(path)) return can(user, L.del);
  if (L.add && isAddPath(path)) return can(user, L.add) || can(user, perm);
  return can(user, perm);
}
// Only the "see" tick for this page (nothing can be changed) — the page shows a small notice.
function viewOnly(user, perm) {
  const L = LEVELS[perm];
  if (!L || !user || user.role === 'owner' || can(user, perm)) return false;
  return !Object.entries(L).some(([k, p]) => k !== 'view' && can(user, p));
}
// Shown in the menu when any level of the permission is given.
function canSee(user, perm) {
  if (perm === 'owner') return !!user && user.role === 'owner';
  const L = LEVELS[perm];
  return can(user, perm) || (!!L && Object.values(L).some((p) => can(user, p)));
}

async function listStaff() {
  return q('SELECT id, name, username, phone, email, role, permissions, active, note, last_login, created_at, totp_on, photo_id, designation, joined_on FROM staff ORDER BY role=\'owner\' DESC, active DESC, name');
}
async function getStaff(id) {
  return one('SELECT * FROM staff WHERE id=$1', [id]);
}
async function findLogin(login) {
  const l = String(login || '').trim().toLowerCase();
  if (!l) return null;
  return one(`SELECT * FROM staff WHERE lower(username)=$1 OR (phone<>'' AND phone=$1) OR (email<>'' AND lower(email)=$1) LIMIT 1`, [l]);
}
async function countStaff() { return (await one('SELECT count(*)::int AS n FROM staff')).n; }

function cleanUsername(u) { return String(u || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40); }

async function saveStaff(data, { isOwnerEditing = true } = {}) {
  const id = int(data.id);
  const username = cleanUsername(data.username);
  if (!str(data.name)) throw new Error('নাম লিখুন।');
  if (username.length < 3) throw new Error('ইউজারনেম কমপক্ষে ৩ অক্ষরের দিন (ইংরেজি ছোট হাতের অক্ষর/সংখ্যা)।');
  const clash = await one('SELECT id FROM staff WHERE lower(username)=$1 AND id<>$2', [username, id]);
  if (clash) throw new Error('এই ইউজারনেম আগে থেকেই আছে, অন্য একটা দিন।');
  const perms = [].concat(data.permissions || []).filter((p) => PERMISSION_KEYS.includes(p));
  const existing = id ? await getStaff(id) : null;
  const role = existing && existing.role === 'owner' ? 'owner' : 'staff';
  const active = role === 'owner' ? true : !!data.active;
  if (id && !existing) throw new Error('স্টাফ পাওয়া যায়নি।');
  if (!id && !data.password) throw new Error('পাসওয়ার্ড দিন।');
  if (data.password) { const bad = passwordProblem(data.password, { username, name: data.name }); if (bad) throw new Error(bad); }
  void isOwnerEditing;
  if (id) {
    await q(`UPDATE staff SET name=$1, username=$2, phone=$3, email=$4, permissions=$5, active=$6, note=$7 WHERE id=$8`,
      [str(data.name, 80), username, str(data.phone, 20), str(data.email, 120), JSON.stringify(role === 'owner' ? [] : perms), active, str(data.note, 500), id]);
    if (data.password) await q('UPDATE staff SET password=$1, password_changed_at=now() WHERE id=$2', [hashPassword(String(data.password)), id]);
    return id;
  }
  return (await one(`INSERT INTO staff(name, username, phone, email, password, role, permissions, active, note)
    VALUES($1,$2,$3,$4,$5,'staff',$6,$7,$8) RETURNING id`,
  [str(data.name, 80), username, str(data.phone, 20), str(data.email, 120), hashPassword(String(data.password)), JSON.stringify(perms), !!data.active, str(data.note, 500)])).id;
}
// ---------------------------------------------------------------- profile (picture, job title, address …)
// Used by the owner (Admin → স্টাফ) for anyone, and by each person for themself (Admin → আমার প্রোফাইল).
const PROFILE_FIELDS = ['designation', 'address', 'emergency_phone', 'joined_on', 'bio'];
function cleanDate(v) {
  const m = String(v || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1950 || d > new Date(Date.now() + 366 * 864e5) ? null : `${m[1]}-${m[2]}-${m[3]}`;
}
async function saveProfile(id, data) {
  if (!('designation' in data) && !('photo_id' in data)) return;
  if ('designation' in data) {
    await q(`UPDATE staff SET designation=$1, address=$2, emergency_phone=$3, joined_on=$4, bio=$5 WHERE id=$6`,
      [str(data.designation, 60), str(data.address, 300), str(data.emergency_phone, 20), cleanDate(data.joined_on), str(data.bio, 500), id]);
  }
  if ('photo_id' in data) await setPhoto(id, data.photo_id);
}
// New picture (a just-uploaded media id) or '' to remove it. The old picture is deleted.
async function setPhoto(id, photoId) {
  const cur = await one('SELECT photo_id FROM staff WHERE id=$1', [id]);
  if (!cur) return;
  const next = int(photoId) || null;
  if (next === cur.photo_id) return;
  if (next) {
    const ok = await one(`UPDATE media SET owner_type='staff', owner_id=$2 WHERE id=$1 AND (owner_type IS NULL OR (owner_type='staff' AND owner_id=$2)) RETURNING id`, [next, id]);
    if (!ok) return;
  }
  await q('UPDATE staff SET photo_id=$1 WHERE id=$2', [next, id]);
  if (cur.photo_id) await q(`DELETE FROM media WHERE id=$1 AND owner_type='staff'`, [cur.photo_id]);
}
async function photoOf(staffId, thumb) {
  return one(`SELECT m.mime, ${thumb ? 'coalesce(m.thumb, m.data)' : 'm.data'} AS data, m.id FROM staff s JOIN media m ON m.id=s.photo_id AND m.owner_type='staff' WHERE s.id=$1`, [staffId]);
}

async function createOwner({ name, username, password }) {
  return (await one(`INSERT INTO staff(name, username, password, role, permissions) VALUES($1,$2,$3,'owner','[]') RETURNING id`,
    [str(name, 80) || 'মালিক', cleanUsername(username) || 'admin', hashPassword(password)])).id;
}
async function setPassword(id, password) { await q('UPDATE staff SET password=$1, password_changed_at=now() WHERE id=$2', [hashPassword(password), id]); }
async function deleteStaff(id) { await q(`DELETE FROM staff WHERE id=$1 AND role<>'owner'`, [id]); }
async function touchLogin(id) { await q('UPDATE staff SET last_login=now() WHERE id=$1', [id]); }

async function activity({ staffId, entity, entityId, limit = 100 } = {}) {
  const params = [];
  const where = [];
  if (staffId) { params.push(staffId); where.push(`a.staff_id=$${params.length}`); }
  if (entity) { params.push(entity); where.push(`a.entity=$${params.length}`); }
  if (entityId) { params.push(entityId); where.push(`a.entity_id=$${params.length}`); }
  params.push(limit);
  return q(`SELECT a.*, s.name AS staff_name FROM activity_log a LEFT JOIN staff s ON s.id=a.staff_id
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC, a.id DESC LIMIT $${params.length}`, params);
}

module.exports = {
  PROFILE_FIELDS, saveProfile, setPhoto, photoOf, cleanDate,
  PERMISSIONS, PERMISSION_KEYS, PRESETS, LEVELS, can, routeAllows, canSee, viewOnly, listStaff, getStaff, findLogin, countStaff, saveStaff, createOwner,
  setPassword, deleteStaff, touchLogin, activity, cleanUsername,
};
