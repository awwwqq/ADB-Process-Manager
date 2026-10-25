const { execFile } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const validApkPath = p => typeof p === 'string' && /^\/(data\/app|system|system_ext|product|vendor)\/[A-Za-z0-9_/.=+~@\-]+\.apk$/.test(p) && !p.split('/').includes('..');
const validImagePath = p => typeof p === 'string' && /^res\/[A-Za-z0-9_./@+\-]+\.(png|webp|jpe?g)$/i.test(p) && !p.split('/').includes('..');
function imageSignature(buffer) {
  if (buffer.length < 24) return false;
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return buffer.toString('ascii', 12, 16) === 'IHDR' && buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(16) <= 2048 && buffer.readUInt32BE(20) > 0 && buffer.readUInt32BE(20) <= 2048;
  return buffer[0] === 255 && buffer[1] === 216 || buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
}
class Icons {
  constructor(adb, dataDir, normalize) { this.adb = adb; this.directory = path.join(dataDir, 'icons'); this.normalize = normalize; this.queue = Promise.resolve(); }
  async batch(serial, packages) {
    if (!Array.isArray(packages) || packages.length > 5 || packages.some(p => !require('./adb.cjs').validPackage(p))) throw new Error('Invalid icon request.');
    await this.adb.checkSerial(serial); const inventory = await this.adb.inventory(serial);
    const result = [];
    for (const pkg of packages) {
      if (!inventory.get(pkg)?.installed) continue;
      const job = this.queue.then(() => this.read(serial, pkg)).catch(() => ({ pkg, icon: null, name: null }));
      this.queue = job.then(() => {}); result.push(await job);
    }
    return result;
  }
  entry(serial, apk, entry, limit = 24 * 1024 * 1024) {
    if (!validApkPath(apk) || !['AndroidManifest.xml', 'resources.arsc'].includes(entry) && !validImagePath(entry)) return Promise.reject(new Error('Invalid APK resource path.'));
    return new Promise((resolve, reject) => execFile(this.adb.executable, ['-s', serial, 'exec-out', 'unzip', '-p', apk, entry],
      { windowsHide: true, timeout: 12000, encoding: null, maxBuffer: limit }, (e, out) => e ? reject(e) : resolve(out)));
  }
  parse(manifest, resources) {
    return new Promise(resolve => {
      const worker = new Worker(path.join(__dirname, 'icon-worker.cjs'), { workerData: { manifest, resources }, resourceLimits: { maxOldGenerationSizeMb: 192 }, stdout: true, stderr: true });
      worker.stdout.resume(); worker.stderr.resume();
      let settled = false;
      const done = value => { if (settled) return; settled = true; clearTimeout(timer); worker.terminate(); resolve(value); };
      const timer = setTimeout(() => done({ paths: [], name: null }), 8000);
      worker.on('message', done); worker.on('error', () => done({ paths: [], name: null })); worker.on('exit', () => done({ paths: [], name: null }));
    });
  }
  async read(serial, pkg) {
    const locations = (await this.adb.shell(serial, 'pm', 'path', '--user', '0', pkg)).split('\n').map(s => s.replace(/^package:/, '').trim()).filter(validApkPath);
    const apk = locations.find(p => p.endsWith('/base.apk')) || locations[0]; if (!apk) return { pkg, icon: null, name: null };
    const key = createHash('sha256').update(`${serial}|${pkg}|${locations.join('|')}`).digest('hex');
    const cache = path.join(this.directory, key + '.json');
    try { const saved = JSON.parse(await fs.readFile(cache, 'utf8')); if (saved.version === 2) return { pkg, icon: saved.icon, name: saved.name }; } catch {}
    const [manifest, resources] = await Promise.all([this.entry(serial, apk, 'AndroidManifest.xml', 2 * 1024 * 1024), this.entry(serial, apk, 'resources.arsc')]);
    const parsed = await this.parse(manifest, resources);
    const candidates = [apk, ...locations.filter(p => /split_config\.(?:xxxhdpi|xxhdpi|xhdpi|hdpi|mdpi)\.apk$/.test(p))].slice(0, 4);
    let icon = null;
    for (const resource of parsed.paths) {
      for (const file of candidates) {
        try { const buffer = await this.entry(serial, file, resource, 2 * 1024 * 1024); if (imageSignature(buffer)) icon = this.normalize(buffer); } catch {}
        if (icon) break;
      }
      if (icon) break;
    }
    await fs.mkdir(this.directory, { recursive: true });
    await fs.writeFile(cache, JSON.stringify({ version: 2, icon, name: parsed.name }));
    return { pkg, icon, name: parsed.name };
  }
}
module.exports = { Icons, validApkPath, validImagePath, imageSignature };
