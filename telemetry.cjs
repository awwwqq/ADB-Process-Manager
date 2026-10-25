function parseCpuCounters(text) {
  return new Map(text.split(/\r?\n/).map(line => {
    const m = line.match(/^(cpu\d*)\s+([\d\s]+)$/); if (!m) return null;
    const n = m[2].trim().split(/\s+/).map(Number);
    return [m[1], { total: n.slice(0, 8).reduce((a, b) => a + b, 0), idle: (n[3] || 0) + (n[4] || 0) }];
  }).filter(Boolean));
}
function cpuDelta(previous, current) {
  if (!previous || !current || current.total <= previous.total || current.idle < previous.idle) return null;
  return Math.max(0, Math.min(100, (1 - (current.idle - previous.idle) / (current.total - previous.total)) * 100));
}
function timeSeconds(time) {
  if (!/^\d+(?::\d+){1,2}(?:\.\d+)?$/.test(time)) return null;
  return time.split(':').reduce((n, part) => n * 60 + Number(part), 0);
}
function parseTimedPs(text) {
  const times = new Map(); const lines = ['USER PID RSS NAME'];
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/); if (!m) continue;
    const seconds = timeSeconds(m[4]); if (seconds === null) continue;
    times.set(Number(m[2]), { seconds, name: m[5] }); lines.push(`${m[1]} ${m[2]} ${m[3]} ${m[5]}`);
  }
  return { text: lines.join('\n'), times };
}
function processDeltas(previous, current, seconds, cores) {
  const byPid = new Map();
  if (!previous || seconds <= 0 || cores <= 0) return byPid;
  for (const [pid, now] of current) {
    const before = previous.get(pid);
    if (before && before.name === now.name && now.seconds >= before.seconds) byPid.set(pid, Math.max(0, Math.min(100, (now.seconds - before.seconds) / seconds / cores * 100)));
  }
  return byPid;
}
module.exports = { parseCpuCounters, cpuDelta, timeSeconds, parseTimedPs, processDeltas };
