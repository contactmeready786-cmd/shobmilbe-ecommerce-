import { test } from 'node:test';
import assert from 'node:assert';
import { isInfraIp, infraName } from '../lib/services/infra-ip';
test('own server, Cloudflare, Google and Facebook are never blocked; others can be', () => {
  for (const [ip, n] of [['172.64.198.182','Cloudflare'],['162.158.216.206','Cloudflare'],['104.23.221.47','Cloudflare'],['141.101.68.193','Cloudflare'],['2a06:98c0:3600::103','Cloudflare'],['64.233.173.228','Google'],['74.125.212.227','Google'],['192.178.15.197','Google'],['66.249.66.1','Google'],['157.240.1.1','Facebook'],['2a03:2880:f12f::1','Facebook'],['51.79.166.142','নিজের সার্ভার'],['127.0.0.1','নিজের সার্ভার'],['::1','নিজের সার্ভার'],['::ffff:127.0.0.1','নিজের সার্ভার']]) assert.strictEqual(infraName(ip), n, ip);
  for (const ip of ['34.88.233.94','45.138.12.18','103.86.108.175','159.223.51.116','2602:fa59:10:62::1','4.154.139.59','168.144.35.50','','unknown','1.2.3','999.1.1.1','gggg::1']) assert.strictEqual(isInfraIp(ip), false, ip);
});
