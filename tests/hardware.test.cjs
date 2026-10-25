const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHardware, parseThermals, parseSensors, parseGpuUsage } = require('../hardware.cjs');
test('identifies the reported chipset and GPU without assuming a phone model', () => {
  const hw = parseHardware('[ro.soc.model]: [SM8635]\n[ro.soc.manufacturer]: [QTI]\n[ro.product.cpu.abi]: [arm64-v8a]', 'processor : 0\nprocessor : 1\n', 'Adreno735');
  assert.equal(hw.soc, 'Qualcomm Snapdragon 8s Gen 3'); assert.equal(hw.gpu, 'Adreno 735'); assert.equal(hw.cores, 2); assert.equal(hw.accelerator, 'Qualcomm Hexagon');
});
test('unknown chipsets retain raw identity and do not invent an accelerator', () => {
  const hw = parseHardware('[ro.soc.model]: [TEST99]\n[ro.soc.manufacturer]: [Vendor]');
  assert.equal(hw.soc, 'Vendor TEST99'); assert.equal(hw.accelerator, null); assert.equal(hw.gpu, 'Not reported'); assert.equal(hw.cores, null);
});
test('thermal parsing ignores cached readings and preserves non-temperature units', () => {
  const sensors = parseThermals('Cached temperatures:\nTemperature{mValue=99.0, mType=0, mName=CPU0, mStatus=3}\nCurrent temperatures from HAL:\nTemperature{mValue=38.0, mType=0, mName=CPU0, mStatus=0}\nTemperature{mValue=3.836, mType=6, mName=vbat, mStatus=6}\nTemperature{mValue=53.0, mType=8, mName=socd, mStatus=6}\nTemperature{mValue=36.0, mType=9, mName=nsp0, mStatus=0}\nCurrent cooling devices');
  assert.equal(sensors.length, 4); assert.equal(sensors[0].value, 38); assert.equal(sensors[1].unit, 'V'); assert.equal(sensors[2].unit, '%'); assert.equal(sensors[3].group, 'NPU');
});
test('permission-denied and missing GPU measurements remain unavailable, not zero', () => {
  assert.equal(parseGpuUsage('Permission denied'), null); assert.equal(parseGpuUsage(''), null); assert.equal(parseGpuUsage('125'), null); assert.equal(parseGpuUsage('0 %'), 0); assert.equal(parseGpuUsage('28.5'), 28.5);
});
test('sensor inventory captures labels and manufacturers without collecting events', () => {
  const sensors = parseSensors('Sensor List:\n0x0200000b) lsm6dsv Accelerometer Non-wakeup | STMicro | ver: 1 | type: android.sensor.accelerometer(1) | perm: n/a\nFusion States:\n0x99) fake | fake | ver: 1 | type: fake |');
  assert.equal(sensors.length, 1); assert.equal(sensors[0].vendor, 'STMicro'); assert.equal(sensors[0].name, 'lsm6dsv Accelerometer Non-wakeup');
});
