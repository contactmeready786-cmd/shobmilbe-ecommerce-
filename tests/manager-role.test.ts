// 👔 The manager (owner, 2026-10-22): every staff permission at once, but never the owner's own things — buying
// prices / profit, staff, security, backups, the recycle bin, purchase corrections. A plain staff member gets only
// what is ticked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../lib/models/staff';
import type { StaffUser } from '../lib/types';

const user = (role: string, permissions: string[] = []) => ({ id: 2, name: 'রহিম', username: 'rahim', role, permissions, active: true }) as StaffUser;

test('manager: every staff permission without ticks', () => {
  const m = user('manager');
  for (const k of S.PERMISSION_KEYS) assert.equal(S.can(m, k), true, k);
  assert.equal(S.routeAllows(m, 'products', 'POST', '/admin/products/5/delete'), true);
  assert.equal(S.routeAllows(m, 'inventory', 'POST', '/admin/purchases/new'), true);
});

test('manager: the owner\'s own things stay the owner\'s', () => {
  const m = user('manager');
  assert.equal(S.can(m, 'see_cost'), false);
  assert.equal(S.can(m, 'owner'), false);
  assert.equal(S.routeAllows(m, 'owner', 'GET', '/admin/staff'), false);
  assert.equal(S.routeAllows(m, 'owner', 'POST', '/admin/purchases/3/edit'), false);
  assert.equal(S.routeAllows(m, 'see_cost', 'GET', '/admin/accounts/pnl'), false);
  assert.equal(S.canSee(m, 'owner'), false);
});

test('staff: only what is ticked; owner: everything', () => {
  const s = user('staff', ['orders']);
  assert.equal(S.can(s, 'orders'), true);
  assert.equal(S.can(s, 'products'), false);
  assert.equal(S.can(s, 'see_cost'), false);
  const o = user('owner');
  assert.equal(S.can(o, 'see_cost'), true);
  assert.equal(S.routeAllows(o, 'owner', 'POST', '/admin/purchases/3/edit'), true);
});
