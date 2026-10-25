const fs = require('node:fs');
const path = require('node:path');
const source = __dirname;
const target = path.resolve(source, '../PhoneTaskManager-Windows');
if (target === source || path.dirname(target) !== path.dirname(source)) throw new Error('Invalid build destination');
fs.cpSync(path.join(source, 'node_modules/electron/dist'), target, { recursive: true });
const appDir = path.join(target, 'resources/app'); fs.mkdirSync(appDir, { recursive: true });
for (const file of ['package.json', 'main.cjs', 'preload.cjs', 'adb.cjs', 'hardware.cjs', 'telemetry.cjs', 'icons.cjs', 'icon-worker.cjs', 'theme.js', 'renderer.js', 'columns.js', 'index.html', 'style.css', 'layout.css', 'performance.css']) fs.copyFileSync(path.join(source, file), path.join(appDir, file));
const lock = JSON.parse(fs.readFileSync(path.join(source, 'package-lock.json'), 'utf8'));
for (const [relative, meta] of Object.entries(lock.packages)) {
  if (relative.startsWith('node_modules/') && !meta.dev && !relative.split('/').includes('..')) fs.cpSync(path.join(source, relative), path.join(appDir, relative), { recursive: true });
}
fs.cpSync(path.join(source, 'platform-tools'), path.join(appDir, 'platform-tools'), { recursive: true });
fs.copyFileSync(path.join(source, 'README.md'), path.join(target, 'README.md'));
if (fs.existsSync(path.join(source, 'LICENSE'))) fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'APP-LICENSE.txt'));
const executable = path.join(target, 'Phone Task Manager.exe');
if (fs.existsSync(executable)) fs.unlinkSync(executable);
fs.renameSync(path.join(target, 'electron.exe'), executable);
console.log('Portable app built at ' + executable);
