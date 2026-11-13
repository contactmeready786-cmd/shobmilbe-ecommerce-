// ⚡ সার্ভারের চাপ (owner, 2026-11-13: "the server's RAM and processor are working far too hard"):
//  • who is using the processor and memory right now — read straight from Linux (/proc), shown on
//    Admin → 🩺 সার্ভার ও ডাটাবেস, so the cause is visible (the website, the database, a new version being built …)
//  • how long each background job took, and how much processor it used (timeJob)
//  • busy(): while the server is under pressure, the background jobs that can wait (market research, AI writing,
//    duplicate scan …) skip their turn, so customers' pages always come first
import * as os from 'node:os';
import * as fs from 'node:fs';

/** the server is busy: 1-minute load at or above 85% of its processor cores */
export function busy(limit = 0.85) {
  const cpus = os.cpus().length || 1;
  return (os.loadavg()[0] || 0) / cpus >= limit;
}

type JobStat = { runs: number; skipped: number; lastMs: number; totalMs: number; cpuMs: number; maxMs: number; at: number };
const jobs = new Map<string, JobStat>();
const stat = (name: string) => { let s = jobs.get(name); if (!s) { s = { runs: 0, skipped: 0, lastMs: 0, totalMs: 0, cpuMs: 0, maxMs: 0, at: 0 }; jobs.set(name, s); } return s; };

/** runs one background job, noting how long it took and how much processor it used; errors are logged, never thrown */
export async function timeJob(name: string, fn: () => Promise<unknown>, { optional = false } = {}) {
  if (optional && busy()) { stat(name).skipped++; return; }
  const t = performance.now();
  const c = process.cpuUsage();
  try { await fn(); } catch (e) { console.error(name, (e as Error).message); }
  const ms = performance.now() - t;
  const cpu = process.cpuUsage(c);
  const s = stat(name);
  s.runs++; s.lastMs = ms; s.totalMs += ms; s.maxMs = Math.max(s.maxMs, ms); s.cpuMs += (cpu.user + cpu.system) / 1000; s.at = Date.now();
}
/** the jobs since this server process started, the heaviest (processor time) first */
export function jobStats() {
  return [...jobs.entries()].map(([name, s]) => ({ name, ...s, avgMs: s.runs ? s.totalMs / s.runs : 0 })).sort((a, b) => b.cpuMs - a.cpuMs);
}

// ---------------------------------------------------------------- who uses the server (Linux /proc)
type Proc = { pid: number; name: string; cmd: string; ticks: number; rss: number };
const PAGE = 4096;
function readProcs(): Proc[] {
  const out: Proc[] = [];
  let pids: string[] = [];
  try { pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return out; }
  for (const pid of pids) {
    try {
      const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const close = st.lastIndexOf(')');
      const name = st.slice(st.indexOf('(') + 1, close);
      const f = st.slice(close + 2).split(' ');
      const ticks = Number(f[11]) + Number(f[12]); // utime + stime
      const rss = Number(f[21]) * PAGE;
      let cmd = '';
      try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0+/g, ' ').trim().slice(0, 200); } catch { /* gone */ }
      out.push({ pid: Number(pid), name, cmd, ticks, rss });
    } catch { /* the process ended meanwhile */ }
  }
  return out;
}
/** what a process is, in the owner's words */
export function label(name: string, cmd: string) {
  const c = cmd.toLowerCase();
  if (/next build|npm run build|tsc |shobmilbe-deploy|npm ci/.test(c)) return '🔨 নতুন আপডেট বানানো (deploy)';
  if (/next-server|next start|next\/dist|node .*server/.test(c) || name === 'next-server') return '🌐 ওয়েবসাইট (Next.js)';
  if (name.startsWith('postgres') || c.startsWith('postgres')) return '🗄️ ডাটাবেস (PostgreSQL)';
  if (/pg_dump|backup/.test(c)) return '💾 ব্যাকআপ';
  if (name === 'nginx' || c.startsWith('nginx')) return '🚪 nginx (সামনের দরজা)';
  if (/cloudflared/.test(c)) return '☁️ Cloudflare';
  if (/apt|dpkg|unattended/.test(c)) return '📦 সার্ভারের নিজের আপডেট';
  if (name === 'node' || name === 'npm') return '🟢 অন্য Node প্রোগ্রাম';
  return `⚙️ ${name}`;
}
export type ProcGroup = { label: string; cpuPct: number; rss: number; count: number };
/** processor (%, of one core = 100) and memory per kind of program, measured over ~1 second */
export async function topProcesses(sampleMs = 1000): Promise<{ groups: ProcGroup[]; cores: number } | null> {
  const a = readProcs();
  if (!a.length) return null;
  await new Promise((r) => setTimeout(r, sampleMs));
  const b = readProcs();
  const before = new Map(a.map((p) => [p.pid, p.ticks]));
  const groups = new Map<string, ProcGroup>();
  const HZ = 100; // Linux clock ticks per second
  for (const p of b) {
    const d = p.ticks - (before.get(p.pid) ?? p.ticks);
    const g = groups.get(label(p.name, p.cmd)) || { label: label(p.name, p.cmd), cpuPct: 0, rss: 0, count: 0 };
    g.cpuPct += (100 * d) / (HZ * (sampleMs / 1000));
    g.rss += p.rss;
    g.count++;
    groups.set(g.label, g);
  }
  return { groups: [...groups.values()].filter((g) => g.rss > 5e6 || g.cpuPct >= 1).sort((x, y) => y.cpuPct - x.cpuPct || y.rss - x.rss).slice(0, 10), cores: os.cpus().length || 1 };
}
/** the website's own Node process: memory in use */
export function selfMemory() {
  const m = process.memoryUsage();
  return { rss: m.rss, heap: m.heapUsed, heapTotal: m.heapTotal, uptimeSec: process.uptime() };
}
