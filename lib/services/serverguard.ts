// 🛡️ Server protection, looked at from inside the VPS (owner, 2026-11-19: "the admin can't show the firewall, SSH and
// Cloudflare-only parts — check them for me"). Read-only: it only reads files any program on the server may read
// (/etc/ssh, /etc/ufw/ufw.conf, /etc/apt, /proc) and never changes anything. Off the real server (tests, CI, a laptop)
// the files are missing and each check says "can't tell" instead of guessing.
import * as fs from 'node:fs';
import * as path from 'node:path';

/** ok: true = protected, false = needs a step, null = can't tell from inside the site */
export type ServerCheck = { key: string; ok: boolean | null; title: string; detail: string };

const read = (f: string): string => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const exists = (f: string): boolean => { try { fs.accessSync(f); return true; } catch { return false; } };

/** The value sshd really uses for a setting: the first line that sets it wins (sshd's own rule); the .d/ files are
 *  read where the main file includes them (Ubuntu puts the Include line at the top, so they come first). */
export function sshdValue(texts: string[], name: string): string | null {
  const want = name.toLowerCase();
  for (const t of texts) {
    for (const raw of t.split('\n')) {
      const line = raw.replace(/#.*/, '').trim();
      if (!line) continue;
      if (/^match\s/i.test(line)) break; // settings inside a Match block apply only to some users
      const [k, ...v] = line.split(/\s+/);
      if (k.toLowerCase() === want) return v.join(' ').toLowerCase();
    }
  }
  return null;
}

/** null = the settings can't all be read from inside the site (a file only root may read, e.g. Ubuntu's
 *  50-cloud-init.conf, can turn passwords back on — so a partial read must never show ✅). */
function sshdTexts(): string[] | null {
  const main = read('/etc/ssh/sshd_config');
  if (!main) return null;
  const dir = '/etc/ssh/sshd_config.d';
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.conf')).sort(); } catch { /* none */ }
  const extra = files.map((f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return null; } });
  if (/^\s*include\s/im.test(main) && extra.some((t) => t === null)) return null;
  return /^\s*include\s/im.test(main) ? [...(extra as string[]), main] : [main];
}

/** Programs running now, by their command line (names only). */
function running(): string[] {
  const out: string[] = [];
  let pids: string[] = [];
  try { pids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p)); } catch { return out; }
  for (const pid of pids) {
    const c = read(`/proc/${pid}/cmdline`).replace(/\0+/g, ' ').trim();
    if (c) out.push(c);
  }
  return out;
}

/** TCP ports this server listens on for the whole internet (not only for itself), from /proc/net/tcp{,6}. */
export function publicPorts(tcp: string, tcp6: string): number[] {
  const ports = new Set<number>();
  const scan = (text: string, v6: boolean) => {
    for (const line of text.split('\n').slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 4 || f[3] !== '0A') continue; // 0A = LISTEN
      const [addr, portHex] = f[1].split(':');
      // the kernel writes each 4-byte group backwards: 127.0.0.1 = 0100007F, ::1 = 0…01000000, ::ffff:127.x = 0…FFFF0000……7F
      const local = v6 ? /^0{24}01000000$/i.test(addr) || /^0{16}FFFF0000[0-9A-F]{6}7F$/i.test(addr) : /^[0-9A-F]{6}7F$/i.test(addr);
      if (!local) ports.add(parseInt(portHex, 16));
    }
  };
  scan(tcp, false); scan(tcp6, true);
  return [...ports].sort((a, b) => a - b);
}

export function serverChecks(): ServerCheck[] {
  const onServer = exists('/etc/os-release') && exists('/proc/net/tcp');
  if (!onServer) return [{ key: 'where', ok: null, title: 'Server checks', detail: 'Not running on the shop\'s own server, so nothing to look at here.' }];
  const procs = running();
  const checks: ServerCheck[] = [];

  // 1. SSH: only keys, never passwords
  const ssh = sshdTexts();
  if (!ssh) checks.push({ key: 'ssh_pw', ok: null, title: 'SSH login only with a key (no passwords)', detail: 'Some SSH settings can only be read by the server\'s root account. An outside test (19 Nov 2026) found the server still offers password login.' });
  else {
    const pw = sshdValue(ssh, 'PasswordAuthentication');
    const kbd = sshdValue(ssh, 'KbdInteractiveAuthentication') ?? sshdValue(ssh, 'ChallengeResponseAuthentication');
    const pwOff = pw === 'no' && kbd !== 'yes';
    checks.push({ key: 'ssh_pw', ok: pwOff, title: 'SSH login only with a key (no passwords)', detail: pwOff
      ? 'Nobody can log into the server by guessing a password — only someone holding a saved key can.'
      : 'The server still accepts passwords over SSH, so robots can keep guessing. Turning passwords off needs one change on the server (Claude can guide it).' });
    const root = sshdValue(ssh, 'PermitRootLogin') ?? 'prohibit-password';
    const rootOk = root === 'no' || root === 'prohibit-password' || root === 'without-password' || root === 'forced-commands-only';
    checks.push({ key: 'ssh_root', ok: rootOk, title: 'Root can\'t log in with a password', detail: rootOk
      ? `Root login: ${root} — the all-powerful root account never accepts a password.`
      : 'Root can log in with a password — the most attacked account on every server.' });
  }

  // 2. Firewall
  const ufw = read('/etc/ufw/ufw.conf');
  const ufwOn = /^\s*ENABLED\s*=\s*yes/im.test(ufw);
  checks.push({ key: 'firewall', ok: ufw ? ufwOn : null, title: 'Firewall (ufw)', detail: !ufw
    ? 'ufw isn\'t used on this server (the doors may be closed another way, e.g. iptables or OVHcloud\'s own firewall).'
    : ufwOn ? 'On — every door the shop doesn\'t need is closed.' : 'Installed but switched off.' });

  // 3. Guessing robots get banned
  const f2b = procs.some((c) => /fail2ban-server/.test(c));
  checks.push({ key: 'fail2ban', ok: f2b, title: 'Robots that keep guessing get banned (fail2ban)', detail: f2b
    ? 'Running — an address that fails to log in again and again is shut out for a while.'
    : 'Not running. Without it, robots can try SSH logins without end.' });

  // 4. Security updates
  const auto = read('/etc/apt/apt.conf.d/20auto-upgrades');
  const autoOn = /Unattended-Upgrade\s+"1"/.test(auto);
  checks.push({ key: 'updates', ok: autoOn, title: 'Ubuntu security updates install themselves', detail: autoOn
    ? 'On — Ubuntu fixes its own security holes every day.'
    : 'Off — security fixes for Ubuntu are not installed by themselves.' });
  const reboot = exists('/var/run/reboot-required');
  checks.push({ key: 'reboot', ok: !reboot, title: 'Updates fully in use', detail: reboot
    ? 'An installed update (usually the Linux kernel) needs one server restart to take effect.'
    : 'No restart waiting.' });

  // 5. What listens to the whole internet
  const ports = publicPorts(read('/proc/net/tcp'), read('/proc/net/tcp6'));
  const odd = ports.filter((p) => ![22, 80, 443].includes(p));
  checks.push({ key: 'ports', ok: odd.length === 0, title: 'Only the needed doors listen to the internet', detail: odd.length
    ? `Also listening to everyone: port ${odd.join(', ')} — the database (5432) and the site itself (3000) should only listen inside the server.`
    : `Only ${ports.join(', ') || 'none'} (SSH and the web). The database and the site listen only inside the server.` });
  return checks;
}
