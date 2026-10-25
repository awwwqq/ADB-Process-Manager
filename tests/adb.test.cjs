const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Adb, parseTop, parseMemory, parseStates, parseProcesses, validPackage } = require('../adb.cjs');
test('Toybox combined CPU header and 8-core normalization use the latest interval', () => {
  const sample = `Tasks: 2\n800%cpu 0%user 800%idle\n PID USER PR NI VIRT RES SHR S[%CPU] %MEM TIME+ ARGS\n12 u0_a1 20 0 10G 2M 1M S 0.0 1.0 0:00 com.test.app\nTasks: 2\n800%cpu 80%user 720%idle\n PID USER PR NI VIRT RES SHR S[%CPU] %MEM TIME+ ARGS\n12 u0_a1 20 0 10G 2M 1M S 40.0 1.0 0:00 com.test.app`;
  const result = parseTop(sample); assert.equal(result.cpu, 10); assert.equal(result.byPid.get(12), 5);
});
test('RAM uses MemAvailable rather than treating cache as occupied', () => {
  const result = parseMemory('MemTotal: 1000 kB\nMemFree: 10 kB\nMemAvailable: 400 kB\nSwapTotal: 500 kB\nSwapFree: 300 kB\n');
  assert.equal(result.usedPercent, 60); assert.equal(result.swapUsed, 200);
});
test('packages group subprocesses and preserve foreground over cached state', () => {
  const states = parseStates(' Proc # 0: fg T/A/TOP 12:com.test.app/u0a1 (top-activity)\n Proc # 1: cch b/ /CEM 13:com.test.app:worker/u0a1 (cch-empty)');
  const rows = parseProcesses('USER PID RSS NAME\nu0_a1 12 1024 com.test.app\nu0_a1 13 2048 com.test.app:worker', { byPid: new Map([[12, 5], [13, 2]]) }, states, new Map([['com.test.app', { system: false }]]));
  assert.equal(rows.length, 1); assert.equal(rows[0].cpu, 7); assert.equal(rows[0].memory, 3); assert.equal(rows[0].state, 'Foreground');
});
test('rejects shell injection and unsupported package identifiers', () => {
  for (const s of ['com.test;reboot', 'com.test app', 'com.test$(id)', '-x', null]) assert.equal(validPackage(s), false);
  assert.equal(validPackage('com.test.app_name'), true);
});
test('mutation requires explicit confirmation before any command', async () => {
  const adb = new Adb('unused', 'unused'); adb.run = () => { throw new Error('Should not execute'); };
  await assert.rejects(adb.execute({ serial: 'test', pkg: 'com.test.app', action: 'remove' }), /Confirmation required/);
});
test('protects the launcher and unreviewed system packages before mutation', async () => {
  const adb = new Adb('unused', 'unused'); adb.checkSerial = async () => {};
  adb.cache.set('test', { info: {}, critical: new Set(['com.test.launcher']) });
  adb.inventory = async () => new Map([['com.test.launcher', { pkg: 'com.test.launcher', installed: true, system: false }], ['com.test.system', { pkg: 'com.test.system', installed: true, system: true }]]);
  await assert.rejects(adb.prepare({ serial: 'test', pkg: 'com.test.launcher', action: 'stop' }), /essential package/);
  await assert.rejects(adb.prepare({ serial: 'test', pkg: 'com.test.system', action: 'remove' }), /four reviewed/);
  await assert.rejects(adb.prepare({ serial: 'test', pkg: 'com.test.system', action: 'stop' }), /limited to user apps/);
});
test('retained-data removal is verified and recorded; restore uses the existing package', async () => {
  const adb = new Adb('unused', 'unused'); const commands = []; let history = [];
  let installed = true; const pkg = 'com.miui.msa.global';
  adb.checkSerial = async () => {}; adb.cache.set('test', { info: {}, critical: new Set() });
  adb.inventory = async () => new Map([[pkg, { pkg, name: 'Xiaomi System Ads', system: true, installed, disabled: false }]]);
  adb.history = () => history; adb.saveHistory = list => { history = structuredClone(list); };
  adb.shell = async (serial, ...args) => { commands.push(args); installed = args[0] === 'cmd'; return 'Success'; };
  const removal = await adb.execute({ serial: 'test', pkg, action: 'remove' }, true);
  assert.deepEqual(commands[0], ['pm', 'uninstall', '-k', '--user', '0', pkg]);
  assert.equal(removal.status, 'success'); assert.equal(history[0].before.installed, true);
  await adb.execute({ serial: 'test', pkg, action: 'restore' }, true);
  assert.deepEqual(commands[1], ['cmd', 'package', 'install-existing', '--user', '0', pkg]);
  assert.equal(history[0].status, 'success'); assert.equal(history.length, 2);
});
test('firmware rejection is recorded as failed with no fallback command', async () => {
  const adb = new Adb('unused', 'unused'); let history = []; let calls = 0;
  adb.prepare = async () => ({ pkg: 'com.miui.analytics', name: 'Analytics', installed: true, disabled: false });
  adb.history = () => history; adb.saveHistory = list => { history = structuredClone(list); };
  adb.shell = async () => { calls++; return 'Exception: Cannot disable system packages.'; };
  await assert.rejects(adb.execute({ serial: 'test', pkg: 'com.miui.analytics', action: 'disable' }, true), /Cannot disable/);
  assert.equal(calls, 1); assert.equal(history[0].status, 'failed');
});
