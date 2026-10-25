const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { parseHardware, parseThermals, parseSensors, parseGpuUsage } = require('./hardware.cjs');
const { parseCpuCounters, cpuDelta, parseTimedPs, processDeltas } = require('./telemetry.cjs');

const LABELS = {
  'com.mi.android.globallauncher': 'POCO Launcher', 'com.android.systemui': 'System UI',
  'com.google.android.gms': 'Google Play services', 'com.android.vending': 'Google Play Store',
  'com.google.android.googlequicksearchbox': 'Google & Assistant', 'com.google.android.apps.messaging': 'Google Messages',
  'com.google.android.inputmethod.latin': 'Gboard', 'com.google.android.as': 'Android System Intelligence',
  'com.google.android.tts': 'Google Speech Services', 'com.google.android.adservices.api': 'Android Ad Services',
  'com.google.android.webview': 'Android System WebView', 'com.facebook.katana': 'Facebook',
  'com.facebook.orca': 'Messenger', 'com.microsoft.appmanager': 'Link to Windows', 'com.whatsapp': 'WhatsApp',
  'com.brave.browser': 'Brave', 'com.openai.chatgpt': 'ChatGPT', 'ph.seabank.seabank': 'SeaBank',
  'com.lazada.android': 'Lazada', 'com.wireguard.android': 'WireGuard', 'com.discord': 'Discord',
  'com.miui.msa.global': 'Xiaomi System Ads', 'com.miui.analytics': 'Xiaomi Analytics',
  'com.mi.appfinder': 'Xiaomi App Finder', 'com.mi.globalminusscreen': 'Xiaomi App Vault',
  'com.xiaomi.discover': 'Xiaomi Themes', 'com.miui.miwallpaper': 'Xiaomi Wallpaper',
  'com.milink.service': 'Xiaomi MiLink', 'com.milink.crossdeviceservice': 'Xiaomi Cross-device',
  'com.xiaomi.mi_connect_service': 'Xiaomi Connectivity', 'com.xiaomi.aicr': 'Xiaomi AI Cognition',
  'com.miui.misound': 'Xiaomi Sound Effects', 'com.miui.powerkeeper': 'Xiaomi PowerKeeper',
  'com.miui.securitycenter': 'Xiaomi Security', 'com.lbe.security.miui': 'Xiaomi Permissions',
  'com.xiaomi.xmsf': 'Xiaomi Push Service', 'com.xiaomi.xmsfkeeper': 'Xiaomi Push Keeper',
  'com.xiaomi.account': 'Xiaomi Account', 'com.xiaomi.joyose': 'Xiaomi Joyose',
  'com.miui.daemon': 'Xiaomi System Daemon', 'com.android.camera': 'Camera',
  'com.android.settings': 'Settings', 'com.google.android.projection.gearhead': 'Android Auto',
  'com.google.android.providers.media.module': 'Android Media Provider',
  'com.google.android.permissioncontroller': 'Android Permissions',
  'net.dinglisch.android.taskerm': 'Tasker', 'com.anydesk.anydeskandroid': 'AnyDesk',
  'org.telegram.messenger': 'Telegram', 'com.spotify.music': 'Spotify', 'com.google.android.youtube': 'YouTube'
};
const NOTES = {
  'com.miui.msa.global': 'Xiaomi advertising and recommendations. Removing it may stop some ads, but other apps can provide their own.',
  'com.miui.analytics': 'Xiaomi usage analytics. Removing it can affect diagnostic reporting.',
  'com.mi.appfinder': 'App-finder integration in the Xiaomi/POCO launcher. Removing it can disable launcher search or recommendations.',
  'com.mi.globalminusscreen': 'Xiaomi App Vault / assistant panel beside the home screen. Removing it disables that panel.',
  'com.microsoft.appmanager': 'Link to Windows syncs phone notifications and other enabled features with your PC. Stopping it interrupts syncing.',
  'com.milink.service': 'Xiaomi casting and device connectivity. Changes can affect media casting and connected devices.',
  'com.xiaomi.aicr': 'Xiaomi AI cognition service. Its dependencies vary by firmware; removal effects are not verified for this device.',
  'com.miui.daemon': 'Xiaomi system daemon. Responsibilities vary by firmware; this prototype does not classify it as safe to remove.',
  'com.xiaomi.xmsf': 'Xiaomi push infrastructure. Removing it can affect notifications and Xiaomi services.'
};
const PROTECTED = new Set(['android', 'com.android.systemui', 'com.android.settings', 'com.android.phone',
  'com.android.bluetooth', 'com.android.providers.settings', 'com.android.providers.telephony',
  'com.android.permissioncontroller', 'com.google.android.permissioncontroller', 'com.google.android.gms',
  'com.google.android.webview', 'com.miui.rom', 'com.android.updater', 'com.miui.securitycenter',
  'com.lbe.security.miui', 'com.miui.powerkeeper', 'com.xiaomi.xmsf', 'com.xiaomi.xmsfkeeper']);
const OPTIONAL = new Set(['com.miui.msa.global', 'com.miui.analytics', 'com.mi.appfinder', 'com.mi.globalminusscreen']);
const validPackage = s => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(s);
function label(pkg) { return LABELS[pkg] || pkg; }
function parsePackages(text) {
  return text.split(/\r?\n/).map(line => {
    const m = line.match(/^package:([^\s]+)(?:\s+uid:(\d+))?/);
    return m ? { pkg: m[1], uid: Number(m[2]) || null } : null;
  }).filter(Boolean);
}
function parseTop(text) {
  const blocks = text.split(/Tasks:/); const last = blocks.at(-1);
  const cpu = last.match(/(\d+)%cpu\s+.*?([\d.]+)%idle/);
  const capacity = Number(cpu?.[1]) || 100;
  const byPid = new Map();
  let header;
  for (const line of last.split(/\r?\n/)) {
    const cols = line.replace('S[%CPU]', 'S %CPU').trim().split(/\s+/);
    if (cols[0] === 'PID') { header = cols.map(x => x.replace(/[\[\]]/g, '')); continue; }
    if (!header || !/^\d+$/.test(cols[0])) continue;
    const n = Number(cols[header.indexOf('%CPU')]);
    byPid.set(Number(cols[0]), Number.isFinite(n) ? n / (capacity / 100) : 0);
  }
  return { cpu: cpu ? Math.max(0, Math.min(100, (capacity - Number(cpu[2])) / capacity * 100)) : null, byPid };
}
function parseMemory(text) {
  const m = Object.fromEntries([...text.matchAll(/^(\w+):\s+(\d+)/gm)].map(x => [x[1], Number(x[2])]));
  return { total: m.MemTotal || 0, available: m.MemAvailable || 0, swapTotal: m.SwapTotal || 0,
    free: m.MemFree ?? null, cached: m.Cached ?? null, buffers: m.Buffers ?? null, reclaimable: m.SReclaimable ?? null,
    swapUsed: Math.max(0, (m.SwapTotal || 0) - (m.SwapFree || 0)),
    usedPercent: m.MemTotal ? (1 - m.MemAvailable / m.MemTotal) * 100 : null };
}
function parseStates(text) {
  const states = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*Proc #.*?\s(\d+):([^\s/]+)\/.*?\(([^)]+)\)/);
    if (m) states.set(Number(m[1]), /cch|cached|recent|previous/.test(m[3]) ? 'Cached' : m[3] === 'top-activity' ? 'Foreground' : 'Background');
  }
  return states;
}
function parseProcesses(text, top, states, inventory) {
  const rows = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(\S+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const [, user, pidText, rssText, name] = m;
    const pid = Number(pidText); let pkg = name.split(':')[0];
    if (!inventory.has(pkg)) pkg = null;
    const key = pkg || name;
    if (!rows.has(key)) rows.set(key, { id: key, pkg, name: pkg ? label(pkg) : name,
      process: name, pids: [], cpu: 0, cpuSamples: 0, memory: 0, state: 'Cached', system: pkg ? inventory.get(pkg).system : true,
      note: NOTES[pkg] || '', optional: OPTIONAL.has(pkg), protected: !pkg || PROTECTED.has(pkg), user });
    const r = rows.get(key); r.pids.push(pid); r.memory += Number(rssText) / 1024;
    r.cpu += top.byPid.get(pid) || 0; if (top.byPid.has(pid)) r.cpuSamples++;
    const state = states.get(pid) || 'System';
    if (r.state !== 'Foreground' && (state !== 'Cached' || r.pids.length === 1)) r.state = state;
  }
  return [...rows.values()].filter(r => r.name !== 'ps' && r.name !== 'top' && !r.name.startsWith('sh -c')).map(r => ({ ...r, cpu: r.cpuSamples ? r.cpu : null }));
}
class Adb {
  constructor(executable, dataDir) { this.executable = executable; this.dataDir = dataDir; this.cache = new Map(); this.locks = new Set(); }
  run(args, timeout = 18000) {
    return new Promise((resolve, reject) => execFile(this.executable, args, { windowsHide: true, timeout, maxBuffer: 12 * 1024 * 1024 }, (err, out, stderr) => {
      if (err) reject(new Error((stderr || err.message).slice(0, 1200))); else resolve(out.replace(/\r/g, ''));
    }));
  }
  async devices() {
    const out = await this.run(['devices', '-l']);
    return out.split('\n').slice(1).map(l => {
      const m = l.match(/^(\S+)\s+(device|unauthorized|offline)\b(.*)/);
      return m ? { serial: m[1], status: m[2], model: m[3].match(/model:(\S+)/)?.[1]?.replaceAll('_', ' ') || m[1] } : null;
    }).filter(Boolean);
  }
  async checkSerial(serial) {
    if (typeof serial !== 'string' || !/^[A-Za-z0-9_.:\-\[\]]{1,150}$/.test(serial)) throw new Error('Invalid device identifier.');
    const devices = await this.devices();
    if (!devices.some(d => d.serial === serial && d.status === 'device')) throw new Error('Phone is disconnected or not authorized. Unlock it and approve USB debugging.');
  }
  shell(serial, ...args) { return this.run(['-s', serial, 'shell', ...args]); }
  async inventory(serial, fresh = false) {
    if (!fresh && this.cache.get(serial)?.inventory) return this.cache.get(serial).inventory;
    const results = await Promise.all([
      this.shell(serial, 'pm', 'list', 'packages', '-U', '--user', '0'),
      this.shell(serial, 'pm', 'list', 'packages', '-s', '--user', '0'),
      this.shell(serial, 'pm', 'list', 'packages', '-d', '--user', '0'),
      this.shell(serial, 'pm', 'list', 'packages', '-u', '--user', '0')
    ]);
    const installed = new Map(parsePackages(results[0]).map(p => [p.pkg, p]));
    const system = new Set(parsePackages(results[1]).map(p => p.pkg));
    const disabled = new Set(parsePackages(results[2]).map(p => p.pkg));
    const inventory = new Map(parsePackages(results[3]).map(p => [p.pkg, {
      pkg: p.pkg, name: label(p.pkg), uid: installed.get(p.pkg)?.uid, installed: installed.has(p.pkg),
      system: system.has(p.pkg) || !installed.has(p.pkg), disabled: disabled.has(p.pkg),
      optional: OPTIONAL.has(p.pkg), note: NOTES[p.pkg] || '', protected: PROTECTED.has(p.pkg)
    }]));
    const entry = this.cache.get(serial) || {}; entry.inventory = inventory; this.cache.set(serial, entry);
    return inventory;
  }
  async connect(serial) {
    await this.checkSerial(serial);
    const props = await this.shell(serial, 'getprop');
    const prop = key => props.match(new RegExp('\\[' + key.replaceAll('.', '\\.') + '\\]: \\[(.*?)\\]'))?.[1] || '';
    const entry = this.cache.get(serial) || {};
    const home = await this.shell(serial, 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME');
    entry.previousSample = null; entry.slow = null;
    const keyboard = await this.shell(serial, 'settings', 'get', 'secure', 'default_input_method');
    entry.critical = new Set([home.trim().split('\n').at(-1)?.split('/')[0], keyboard.trim().split('/')[0]]);
    entry.info = { serial, manufacturer: prop('ro.product.manufacturer'), model: prop('ro.product.model'),
      name: prop('ro.product.marketname') || prop('ro.product.vendor.marketname') || prop('ro.product.model'),
      android: prop('ro.build.version.release'), build: prop('ro.build.version.incremental') };
    const hardwareReads = await Promise.allSettled([
      this.shell(serial, 'cat', '/proc/cpuinfo'),
      this.shell(serial, 'cat', '/sys/class/kgsl/kgsl-3d0/gpu_model'),
      this.shell(serial, 'dumpsys', 'sensorservice')
    ]);
    const readHardware = i => hardwareReads[i].status === 'fulfilled' ? hardwareReads[i].value : '';
    entry.info.hardware = parseHardware(props, readHardware(0), readHardware(1));
    entry.info.sensors = parseSensors(readHardware(2));
    this.cache.set(serial, entry); await this.inventory(serial, true);
    return entry.info;
  }
  async snapshot(serial) {
    const started = Date.now();
    await this.checkSerial(serial);
    if (!this.cache.get(serial)?.info) await this.connect(serial);
    const inventory = await this.inventory(serial);
    const entry = this.cache.get(serial);
    const refreshDetails = !entry.slow || started - entry.detailsAt >= 3900;
    const commands = [ ['cat', '/proc/stat'], ['ps', '-A', '-o', 'USER,PID,RSS,TIME+,NAME'], ['cat', '/proc/meminfo'],
      ...(refreshDetails ? [['dumpsys', 'activity', 'processes'], ['dumpsys', 'battery'], ['df', '-k', '/data'],
        ['cat', '/proc/uptime'], ['dumpsys', 'thermalservice'], ['cat', '/sys/class/kgsl/kgsl-3d0/gpu_busy_percentage'],
        ['cat', '/sys/class/kgsl/kgsl-3d0/gpuclk'], ['cat', '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq']] : []) ];
    const results = await Promise.allSettled(commands.map(c => this.shell(serial, ...c)));
    if (refreshDetails) { entry.slow = results.slice(3).map(r => r.status === 'fulfilled' ? r.value : ''); entry.detailsAt = started; }
    const get = i => i < 3 ? results[i].status === 'fulfilled' ? results[i].value : '' : entry.slow[i - 3] || '';
    if (results[0].status === 'rejected' && results[1].status === 'rejected') throw new Error('Could not read phone processes. Reconnect the phone and retry.');
    const counters = parseCpuCounters(get(0)); const timed = parseTimedPs(get(1)); const memory = parseMemory(get(2));
    const previous = entry.previousSample; const cores = [...counters.keys()].filter(k => k !== 'cpu').length || entry.info.hardware?.cores || 1;
    const elapsed = previous ? (started - previous.at) / 1000 : 0;
    const cpu = cpuDelta(previous?.counters.get('cpu'), counters.get('cpu'));
    const byPid = processDeltas(previous?.times, timed.times, elapsed, cores);
    const rows = parseProcesses(timed.text, { byPid }, parseStates(get(3)), inventory);
    if (counters.size && timed.times.size) entry.previousSample = { at: started, counters, times: timed.times };
    const critical = this.cache.get(serial)?.critical || new Set();
    for (const row of rows) if (critical.has(row.pkg)) row.protected = true;
    const battery = get(4); const df = get(5).trim().split('\n').at(-1)?.trim().split(/\s+/) || [];
    const thermals = parseThermals(get(7));
    const cpus = thermals.filter(s => s.type === 0).map(s => s.value);
    const gpuClock = Number(get(9).trim());
    return { at: started, rows, memory, cpu, info: entry.info,
      coreUsage: [...counters].filter(([name]) => name !== 'cpu').map(([name, current]) => ({ name, usage: cpuDelta(previous?.counters.get(name), current) })),
      sampling: { durationMs: Date.now() - started, intervalMs: previous ? started - previous.at : null, detailsAt: entry.detailsAt },
      cpu0MHz: Number(get(10).trim()) > 0 ? Number(get(10).trim()) / 1000 : null,
      battery: { level: Number(battery.match(/\blevel:\s*(\d+)/)?.[1]) || 0,
        temperature: Number(battery.match(/\btemperature:\s*(\d+)/)?.[1]) / 10 || null,
        charging: /(?:USB|AC|Wireless) powered: true/.test(battery) },
      cpuTemperature: cpus.length ? Math.max(...cpus) : null,
      thermals, gpu: { usage: parseGpuUsage(get(8)), clockMHz: Number.isFinite(gpuClock) && gpuClock > 0 ? gpuClock / 1000000 : null },
      thermalStatus: get(7).match(/Thermal Status:\s*(\d+)/) ? Number(get(7).match(/Thermal Status:\s*(\d+)/)[1]) : null,
      storage: { total: Number(df[1]) || 0, used: Number(df[2]) || 0, free: Number(df[3]) || 0 },
      uptime: Number.parseFloat(get(6)) || 0,
      warnings: results.slice(0, 3).map((r, i) => r.status === 'rejected' ? ['CPU counters', 'Processes', 'Memory'][i] + ' unavailable' : null).filter(Boolean) };
  }
  history() {
    try { return JSON.parse(fs.readFileSync(path.join(this.dataDir, 'changes.json'), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return []; throw new Error('Change history could not be read. No phone changes will be made.'); }
  }
  saveHistory(list) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const file = path.join(this.dataDir, 'changes.json'); fs.writeFileSync(file + '.tmp', JSON.stringify(list, null, 2)); fs.renameSync(file + '.tmp', file);
  }
  async prepare(request) {
    if (!request || !validPackage(request.pkg) || !['stop', 'disable', 'remove', 'restore', 'enable'].includes(request.action)) throw new Error('Invalid action.');
    await this.checkSerial(request.serial);
    if (!this.cache.get(request.serial)?.info) await this.connect(request.serial);
    const inventory = await this.inventory(request.serial, true); const p = inventory.get(request.pkg);
    if (!p) throw new Error('Package no longer exists on this phone. Refresh the list.');
    if ((PROTECTED.has(p.pkg) || this.cache.get(request.serial).critical?.has(p.pkg)) && !['restore', 'enable'].includes(request.action)) throw new Error('This essential package is protected in the prototype.');
    if (request.action === 'stop' && p.system) throw new Error('Force stop is limited to user apps in this version.');
    if (['disable', 'remove'].includes(request.action) && p.system && !OPTIONAL.has(p.pkg)) throw new Error('System changes are limited to the four reviewed Xiaomi packages in this version.');
    if (request.action === 'restore' && p.installed) throw new Error('This package is already installed.');
    if (['disable', 'remove'].includes(request.action) && p.disabled) throw new Error('This package is already disabled. Re-enable it before making a different change.');
    if (request.action !== 'restore' && !p.installed) throw new Error('This package is not installed for user 0.');
    return p;
  }
  async execute(request, confirmed = false) {
    if (!confirmed) throw new Error('Confirmation required.');
    if (this.locks.has(request.serial)) throw new Error('Another change is in progress.');
    this.locks.add(request.serial);
    let record;
    try {
      const p = await this.prepare(request);
      const args = { stop: ['am', 'force-stop', '--user', '0', p.pkg],
        disable: ['pm', 'disable-user', '--user', '0', p.pkg],
        remove: ['pm', 'uninstall', '-k', '--user', '0', p.pkg],
        restore: ['cmd', 'package', 'install-existing', '--user', '0', p.pkg],
        enable: ['pm', 'default-state', '--user', '0', p.pkg] }[request.action];
      record = { id: require('node:crypto').randomUUID(), at: Date.now(), serial: request.serial,
        pkg: p.pkg, name: p.name, action: request.action, before: { installed: p.installed, disabled: p.disabled }, status: 'pending' };
      this.saveHistory([record, ...this.history()]);
      const out = await this.shell(request.serial, ...args);
      if (/Exception|Failure|Error:|not allowed|Cannot /i.test(out)) throw new Error(out.slice(0, 700));
      const updated = await this.inventory(request.serial, true); const state = updated.get(p.pkg);
      if (request.action === 'remove' && state?.installed) throw new Error('Package is still installed; removal was not verified.');
      if (request.action === 'disable' && !state?.disabled) throw new Error('Package was not disabled. This firmware may block disabling system packages.');
      if (request.action === 'restore' && !state?.installed) throw new Error('Package restoration was not verified.');
      if (request.action === 'enable' && state?.disabled) throw new Error('Package is still disabled.');
      record.status = 'success'; record.output = out.trim();
      this.saveHistory(this.history().map(x => x.id === record.id ? record : x)); return record;
    } catch (e) {
      if (record) { record.status = 'failed'; record.output = e.message; this.saveHistory(this.history().map(x => x.id === record.id ? record : x)); }
      throw e;
    } finally { this.locks.delete(request.serial); }
  }
}
module.exports = { Adb, parseTop, parseMemory, parseProcesses, parseStates, parsePackages, validPackage, PROTECTED, OPTIONAL };
