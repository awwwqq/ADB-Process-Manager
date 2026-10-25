const { test } = require('node:test'); const assert = require('node:assert/strict');
const { parseCpuCounters, cpuDelta, timeSeconds, parseTimedPs, processDeltas } = require('../telemetry.cjs');
const { validApkPath, validImagePath, imageSignature } = require('../icons.cjs');
test('CPU counters exclude guest double-counting and report deltas, not lifetime averages', () => {
  const before = parseCpuCounters('cpu 10 0 10 80 0 0 0 0 5 0\ncpu0 10 0 10 80 0 0 0 0');
  const after = parseCpuCounters('cpu 40 0 20 140 0 0 0 0 5 0\ncpu0 40 0 20 140 0 0 0 0');
  assert.equal(before.get('cpu').total, 100); assert.equal(cpuDelta(before.get('cpu'), after.get('cpu')), 40);
  assert.equal(cpuDelta(null, after.get('cpu')), null); assert.equal(cpuDelta(after.get('cpu'), before.get('cpu')), null);
});
test('cumulative process TIME+ becomes normalized per-interval CPU', () => {
  assert.equal(timeSeconds('1:02:03.50'), 3723.5); assert.equal(timeSeconds('2:03.25'), 123.25); assert.equal(timeSeconds('oops'), null);
  const before = parseTimedPs('USER PID RSS TIME+ NAME\nu0_a1 123 2048 0:10.00 com.test.app');
  const after = parseTimedPs('USER PID RSS TIME+ NAME\nu0_a1 123 2048 0:10.40 com.test.app');
  assert.ok(Math.abs(processDeltas(before.times, after.times, 1, 8).get(123) - 5) < 1e-9);
  assert.ok(after.text.includes('u0_a1 123 2048 com.test.app'));
  after.times.get(123).name = 'different'; assert.equal(processDeltas(before.times, after.times, 1, 8).size, 0);
});
test('APK resources are limited to installed package paths and raster image entries', () => {
  assert.equal(validApkPath('/data/app/~~abc==/com.test.app-xyz==/base.apk'), true);
  for (const p of ['/sdcard/secret.apk', '/data/app/../secret.apk', '/data/app/test;reboot.apk']) assert.equal(validApkPath(p), false);
  assert.equal(validImagePath('res/mipmap-hdpi-v4/ic_launcher.png'), true);
  for (const p of ['res/../secret.png', 'res/icon.svg', 'res/icon.png;reboot']) assert.equal(validImagePath(p), false);
  assert.equal(imageSignature(Buffer.from('<svg onload="bad"/>')), false);
  assert.equal(imageSignature(Buffer.from('89504e470d0a1a0a0000000000', 'hex')), false);
});
