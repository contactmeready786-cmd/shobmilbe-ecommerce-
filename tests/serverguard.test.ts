// 🛡️ Server checks seen from inside the VPS (lib/services/serverguard.ts, owner 2026-11-19): reading sshd's settings
// the way sshd does, and telling ports open to everyone from ports that listen only inside the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sshdValue, publicPorts, serverChecks } from '../lib/services/serverguard';

test('sshd: the first setting wins, comments and Match blocks are skipped', () => {
  const d = 'PasswordAuthentication no\n';
  const main = '# PasswordAuthentication yes\nInclude /etc/ssh/sshd_config.d/*.conf\nPasswordAuthentication yes\nMatch User x\n  PermitRootLogin yes\n';
  assert.equal(sshdValue([d, main], 'PasswordAuthentication'), 'no');
  assert.equal(sshdValue([main], 'passwordauthentication'), 'yes');
  assert.equal(sshdValue([main], 'PermitRootLogin'), null);
});

test('ports: loopback listeners are private, 0.0.0.0 and :: are public', () => {
  const head = '  sl  local_address rem_address   st\n';
  const tcp = head
    + '   0: 00000000:0016 00000000:0000 0A x\n' // 0.0.0.0:22
    + '   1: 0100007F:1538 00000000:0000 0A x\n' // 127.0.0.1:5432
    + '   2: 0100007F:0BB8 00000000:0000 0A x\n' // 127.0.0.1:3000
    + '   3: 00000000:01BB 00000000:0000 01 x\n'; // established, not listening
  const tcp6 = head
    + '   0: 00000000000000000000000000000000:0050 00000000000000000000000000000000:0000 0A x\n' // [::]:80
    + '   1: 00000000000000000000000001000000:1538 00000000000000000000000000000000:0000 0A x\n'; // [::1]:5432
  assert.deepEqual(publicPorts(tcp, tcp6), [22, 80]);
});

test('off the server every check answers without throwing', () => {
  const r = serverChecks();
  assert.ok(Array.isArray(r) && r.length > 0);
  for (const c of r) assert.ok(c.ok === true || c.ok === false || c.ok === null);
});
