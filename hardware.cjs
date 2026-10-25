// Model mapping verified against Xiaomi's POCO F6 processor specifications and
// Qualcomm's SM8635 product brief. Unknown chipsets retain the device's raw ID.
const SOCS = {
  SM8635: { name: 'Qualcomm Snapdragon 8s Gen 3', cpu: '1 × Cortex-X4 · 4 × Cortex-A720 · 3 × Cortex-A520',
    gpu: 'Qualcomm Adreno 735', accelerator: 'Qualcomm Hexagon', acceleratorKind: 'NPU / AI accelerator',
    source: 'https://www.mi.com/uk/support/faq/details/KA-165333/' }
};
function parseHardware(props, cpuinfo = '', gpuModel = '') {
  const get = key => props.split('\n').find(l => l.startsWith(`[${key}]: [`))?.slice(key.length + 5, -1).trim() || '';
  const id = get('ro.soc.model'); const known = SOCS[id.toUpperCase()];
  const reportedGpu = gpuModel.trim().replace(/Adreno\s*(\d+)/i, 'Adreno $1');
  return { socId: id || null, soc: known?.name || [get('ro.soc.manufacturer'), id].filter(Boolean).join(' ') || 'Not reported',
    cpu: known?.cpu || 'Core architecture not reported', cores: [...cpuinfo.matchAll(/^processor\s*:/gm)].length || null,
    abi: get('ro.product.cpu.abi') || 'Not reported', platform: get('ro.board.platform') || 'Not reported',
    gpu: reportedGpu && !/permission|not found|error/i.test(reportedGpu) ? reportedGpu : known?.gpu || get('ro.hardware.vulkan') || 'Not reported',
    gpuSource: reportedGpu ? 'Reported by device' : known ? 'Chipset specification' : 'Reported driver family',
    accelerator: known?.accelerator || null, acceleratorKind: known?.acceleratorKind || 'NPU / APU',
    source: known?.source || null };
}
function parseThermals(text) {
  const live = text.split('Current temperatures from HAL:')[1]?.split('Current cooling devices')[0] || '';
  const types = { 0: 'CPU', 1: 'GPU', 2: 'Battery', 3: 'Skin', 4: 'USB port', 5: 'Power amplifier', 6: 'Battery voltage', 7: 'Battery current', 8: 'Battery charge / vendor', 9: 'NPU' };
  return [...live.matchAll(/Temperature\{mValue=([-\d.]+), mType=(-?\d+), mName=([^,}]+), mStatus=(\d+)\}/g)].map(m => {
    const type = Number(m[2]); const unit = type === 6 ? 'V' : type === 7 ? 'mA' : type === 8 ? '%' : type >= 0 && type <= 9 ? '°C' : 'raw';
    return { name: m[3], group: types[type] || 'Vendor sensor', type, value: Number(m[1]), unit, status: Number(m[4]) };
  }).filter(s => Number.isFinite(s.value));
}
function parseSensors(text) {
  const list = text.split('Sensor List:')[1]?.split(/Fusion States:|Recent Sensor events:|Active sensors:|Sensor Event Connection|Direct Connection/)[0] || '';
  return [...list.matchAll(/^\s*(0x[\da-f]+)\)\s+(.+?)\s*\|\s*(.*?)\s*\|.*?type:\s*([^|]+?)\s*\|/gim)].map(m => ({
    id: m[1], name: m[2].trim(), vendor: m[3].trim(), type: m[4].trim()
  }));
}
function parseGpuUsage(text) { const m = text.trim().match(/^(\d+(?:\.\d+)?)\s*%?$/); const n = m ? Number(m[1]) : NaN; return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null; }
module.exports = { parseHardware, parseThermals, parseSensors, parseGpuUsage };
