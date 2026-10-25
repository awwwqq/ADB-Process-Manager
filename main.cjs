const { app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, nativeImage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Adb } = require('./adb.cjs');
const { Icons } = require('./icons.cjs');
let win, adb;
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
const page = pathToFileURL(path.join(__dirname, 'index.html')).href;
function check(event) { if (event.senderFrame?.url !== page) throw new Error('Untrusted page.'); }
function handle(channel, fn) { ipcMain.handle(channel, async (event, ...args) => { check(event); try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: e.message }; } }); }
const EFFECTS = {
  stop: 'Force-stopping ends every process for this app and can interrupt downloads, calls, notifications, and unsaved work. Open the app on your phone to use it again.',
  disable: 'The app will be disabled for Android user 0. Its features and background services will stop. Data is retained. You can re-enable it from Apps or Changes.',
  remove: 'The app will be removed from Android user 0 with its data retained. Its features will stop. For system apps, the system copy remains and can be restored. Retaining data is not a backup. Updates and manufacturer behavior can affect restoration.',
  restore: 'Re-register this package for Android user 0 using its existing system copy. Its services may start again.',
  enable: 'Return this app to its default enabled state. Its services may start again.'
};
const VERBS = { stop: 'Force stop', disable: 'Disable', remove: 'Remove for user', restore: 'Restore', enable: 'Re-enable' };
async function perform(request) {
  const p = await adb.prepare(request);
  const answer = await dialog.showMessageBox(win, {
    type: ['remove', 'disable'].includes(request.action) ? 'warning' : 'question',
    title: `${VERBS[request.action]} ${p.name}?`, message: `${VERBS[request.action]} ${p.name}?`,
    detail: `${p.pkg}\nDevice: ${request.serial}\n\n${p.note ? p.note + '\n\n' : ''}${EFFECTS[request.action]}`,
    buttons: ['Cancel', VERBS[request.action]], defaultId: 0, cancelId: 0, noLink: true
  });
  if (answer.response !== 1) return { cancelled: true };
  return adb.execute(request, true);
}
app.whenReady().then(() => {
  app.setAppUserModelId('local.phone-task-manager');
  adb = new Adb(path.join(__dirname, 'platform-tools', 'adb.exe'), app.getPath('userData'));
  const icons = new Icons(adb, app.getPath('userData'), buffer => {
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'data:image/webp;base64,' + buffer.toString('base64');
    const picture = nativeImage.createFromBuffer(buffer); if (picture.isEmpty()) return null;
    return picture.resize({ width: 64, height: 64, quality: 'best' }).toDataURL();
  });
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({ width: 1350, height: 880, minWidth: 1060, minHeight: 680,
    backgroundColor: '#101113', title: 'Phone Task Manager', frame: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
  handle('devices', () => adb.devices());
  handle('connect', s => adb.connect(s));
  handle('snapshot', s => adb.snapshot(s));
  handle('packages', async s => { await adb.checkSerial(s); return [...(await adb.inventory(s, true)).values()].map(p => ({ ...p, protected: p.protected || adb.cache.get(s)?.critical?.has(p.pkg) })); });
  handle('history', () => adb.history());
  handle('icons', (serial, packages) => icons.batch(serial, packages));
  handle('theme', theme => { if (!['light', 'dark'].includes(theme)) throw new Error('Invalid theme.'); nativeTheme.themeSource = theme; win.setBackgroundColor(theme === 'light' ? '#f3f5f7' : '#101113'); return theme; });
  handle('action', perform);
  handle('undo', async id => {
    const history = adb.history(); const record = history.find(x => x.id === id);
    if (!record || record.status !== 'success' || record.restoredAt || !['disable', 'remove'].includes(record.action)) throw new Error('This change cannot be restored from history.');
    const result = await perform({ serial: record.serial, pkg: record.pkg, action: record.action === 'remove' ? 'restore' : 'enable' });
    if (!result.cancelled) adb.saveHistory(adb.history().map(x => x.id === id ? { ...x, restoredAt: Date.now() } : x));
    return result;
  });
  ipcMain.on('window', (event, action) => { check(event); if (action === 'minimize') win.minimize(); if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize(); if (action === 'close') win.close(); });
  win.loadURL(page); win.once('ready-to-show', () => win.show());
});
app.on('window-all-closed', () => app.quit());
