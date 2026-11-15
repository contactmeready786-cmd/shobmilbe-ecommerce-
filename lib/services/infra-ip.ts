// 🛡️ Addresses the security watch (services/guard.ts) never blocks — owner, 2026-11-15: the shop's own server and the
// big shared networks — Cloudflare (the site sits behind it; Workers, previews and many fetchers come from it), Google
// (Googlebot, Gemini / AI fetches, Merchant Center, image proxies) and Facebook (link previews, catalog, crawler).
// Blocking one of these shut out the AI tools, the feeds and possibly many real customers at once, while the probes
// they carry find nothing anyway (the site has no .env, .git or PHP). Lists: cloudflare.com/ips, Google's published
// front-end ranges, Facebook AS32934. Kept short and broad on purpose.

const NETS: Record<string, string[]> = {
  'নিজের সার্ভার': ['51.79.166.142/32', '2402:1f00:8000:800::204/128', '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12',
    '192.168.0.0/16', '::1/128', 'fc00::/7'],
  Cloudflare: ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
    '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15',
    '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32', '2606:4700::/32',
    '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'],
  Google: ['64.233.160.0/19', '66.102.0.0/20', '66.249.64.0/19', '72.14.192.0/18', '74.125.0.0/16', '108.177.0.0/17',
    '142.250.0.0/15', '172.217.0.0/16', '173.194.0.0/16', '192.178.0.0/15', '209.85.128.0/17', '216.239.32.0/19',
    '2001:4860::/32', '2404:6800::/32', '2607:f8b0::/32', '2800:3f0::/32', '2a00:1450::/32', '2c0f:fb50::/32'],
  Facebook: ['31.13.24.0/21', '31.13.64.0/18', '66.220.144.0/20', '69.63.176.0/20', '69.171.224.0/19', '157.240.0.0/16',
    '173.252.64.0/18', '179.60.192.0/22', '185.60.216.0/22', '129.134.0.0/16', '2a03:2880::/29'],
};

const ALL6 = (1n << 128n) - 1n;

function v4num(ip: string): bigint | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return BigInt(p[0] * 16777216 + p[1] * 65536 + p[2] * 256 + p[3]);
}
function v6num(ip: string): bigint | null {
  const s = ip.toLowerCase();
  if (!s.includes(':') || !/^[0-9a-f:]+$/.test(s)) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const a = halves[0] ? halves[0].split(':') : [];
  const b = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - a.length - b.length : 0;
  if (fill < 0) return null;
  const parts = [...a, ...Array<string>(fill).fill('0'), ...b];
  if (parts.length !== 8) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
    n = (n << 16n) + BigInt(parseInt(p, 16));
  }
  return n;
}

type Range = { v6: boolean; net: bigint; mask: bigint; name: string };
const RANGES: Range[] = Object.entries(NETS).flatMap(([name, list]) => list.map((c) => {
  const [base, bits] = c.split('/');
  const n4 = v4num(base);
  const v6 = n4 === null;
  const width = v6 ? 128n : 32n;
  const all = v6 ? ALL6 : (1n << 32n) - 1n;
  const mask = (all << (width - BigInt(Number(bits)))) & all;
  return { v6, net: (v6 ? v6num(base)! : n4!) & mask, mask, name };
}));

/** the network an address belongs to ('নিজের সার্ভার', 'Cloudflare', 'Google', 'Facebook'), or '' */
export function infraName(raw: unknown): string {
  let ip = String(raw || '').trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  const n4 = v4num(ip);
  const n6 = n4 === null ? v6num(ip) : null;
  if (n4 === null && n6 === null) return '';
  const hit = RANGES.find((r) => (n4 !== null ? !r.v6 && (n4 & r.mask) === r.net : r.v6 && (n6! & r.mask) === r.net));
  return hit ? hit.name : '';
}
/** true for the shop's own server, private addresses, Cloudflare, Google and Facebook */
export const isInfraIp = (ip: unknown): boolean => infraName(ip) !== '';
