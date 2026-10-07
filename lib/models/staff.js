'use strict';
// Staff accounts and what each one may do.
const { q, one } = require('../db');
const { hashPassword, str, int } = require('../util');

// Every permission a staff member can be given. The owner always has all of them.
const PERMISSIONS = [
  ['dashboard', 'ড্যাশবোর্ড ও বিক্রির গ্রাফ', 'বিক্রি, অর্ডার আর লাভের সংখ্যা দেখতে পারবে'],
  ['orders', 'অর্ডার দেখা', 'অর্ডার লিস্ট আর ডিটেইলস দেখতে পারবে'],
  ['orders_edit', 'অর্ডার এডিট ও অবস্থা বদল', 'অর্ডার কনফার্ম/বাতিল, পণ্য-দাম-ঠিকানা এডিট, নতুন অর্ডার তৈরি'],
  ['courier', 'কুরিয়ারে পাঠানো', 'অর্ডার কুরিয়ারে পাঠাতে আর স্ট্যাটাস আপডেট করতে পারবে'],
  ['products', 'পণ্য ও ক্যাটাগরি', 'পণ্য যোগ, এডিট, দাম, ছবি, বান্ডেল, ক্যাটাগরি'],
  ['see_cost', 'কেনা দাম ও লাভ দেখা', 'পণ্যের কেনা দাম আর লাভের হিসাব দেখতে পারবে'],
  ['inventory', 'স্টক ও পারচেজ', 'স্টক বদল, সাপ্লায়ার আর পারচেজ'],
  ['customers', 'কাস্টমার ও ব্লক লিস্ট', 'কাস্টমারের তথ্য দেখা/এডিট আর ব্লক করা'],
  ['marketing', 'মার্কেটিং ও কুপন', 'পিক্সেল, SEO, কুপন/অফার, লাইভ চ্যাট'],
  ['blog', 'ব্লগ', 'ব্লগ পোস্ট লেখা ও প্রকাশ'],
  ['design', 'স্টোর ডিজাইন', 'লোগো, ব্যানার, মেনু, পেজ, হোমপেজ'],
  ['accounting', 'হিসাব-নিকাশ', 'আয়-ব্যয়, ব্যাংক ব্যালেন্স, লাভ-ক্ষতি, ভ্যাট'],
  ['reports', 'রিপোর্ট ও এক্সপোর্ট', 'বিক্রি ও স্টাফ রিপোর্ট, CSV ডাউনলোড'],
  ['settings', 'সেটিংস ও ইন্টিগ্রেশন', 'দোকানের সেটিংস, পেমেন্ট, কুরিয়ার API, ডোমেইন'],
];
const PERMISSION_KEYS = PERMISSIONS.map((p) => p[0]);
// Ready-made roles to fill the checkboxes quickly.
const PRESETS = {
  order_manager: { label: 'অর্ডার ম্যানেজার', perms: ['dashboard', 'orders', 'orders_edit', 'courier', 'customers'] },
  moderator: { label: 'মডারেটর (শুধু কনফার্ম কল)', perms: ['orders', 'orders_edit', 'customers'] },
  product_manager: { label: 'প্রোডাক্ট ম্যানেজার', perms: ['products', 'inventory'] },
  marketer: { label: 'মার্কেটার', perms: ['dashboard', 'marketing', 'blog', 'design', 'reports'] },
  accountant: { label: 'হিসাবরক্ষক', perms: ['dashboard', 'orders', 'accounting', 'reports', 'see_cost', 'inventory'] },
};

function can(user, perm) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

async function listStaff() {
  return q('SELECT id, name, username, phone, email, role, permissions, active, note, last_login, created_at FROM staff ORDER BY role=\'owner\' DESC, active DESC, name');
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
  if (!id && String(data.password || '').length < 6) throw new Error('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন।');
  if (data.password && String(data.password).length < 6) throw new Error('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন।');
  void isOwnerEditing;
  if (id) {
    await q(`UPDATE staff SET name=$1, username=$2, phone=$3, email=$4, permissions=$5, active=$6, note=$7 WHERE id=$8`,
      [str(data.name, 80), username, str(data.phone, 20), str(data.email, 120), JSON.stringify(role === 'owner' ? [] : perms), active, str(data.note, 500), id]);
    if (data.password) await q('UPDATE staff SET password=$1 WHERE id=$2', [hashPassword(String(data.password)), id]);
    return id;
  }
  return (await one(`INSERT INTO staff(name, username, phone, email, password, role, permissions, active, note)
    VALUES($1,$2,$3,$4,$5,'staff',$6,$7,$8) RETURNING id`,
  [str(data.name, 80), username, str(data.phone, 20), str(data.email, 120), hashPassword(String(data.password)), JSON.stringify(perms), !!data.active, str(data.note, 500)])).id;
}
async function createOwner({ name, username, password }) {
  return (await one(`INSERT INTO staff(name, username, password, role, permissions) VALUES($1,$2,$3,'owner','[]') RETURNING id`,
    [str(name, 80) || 'মালিক', cleanUsername(username) || 'admin', hashPassword(password)])).id;
}
async function setPassword(id, password) { await q('UPDATE staff SET password=$1 WHERE id=$2', [hashPassword(password), id]); }
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
  PERMISSIONS, PERMISSION_KEYS, PRESETS, can, listStaff, getStaff, findLogin, countStaff, saveStaff, createOwner,
  setPassword, deleteStaff, touchLogin, activity, cleanUsername,
};
