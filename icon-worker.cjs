const { parentPort, workerData } = require('node:worker_threads');
try {
  const Apk = require('app-info-parser/src/apk');
  const { mapInfoResource } = require('app-info-parser/src/utils');
  const parser = Object.create(Apk.prototype);
  const manifest = parser._parseManifest(Buffer.from(workerData.manifest));
  const resources = parser._parseResourceMap(Buffer.from(workerData.resources));
  const info = mapInfoResource(manifest, resources);
  const value = info.application?.icon;
  const paths = [...new Set((Array.isArray(value) ? value : [value]).filter(v => typeof v === 'string' && /^res\/[A-Za-z0-9_./@+\-]+\.(png|webp|jpe?g)$/i.test(v) && !v.split('/').includes('..')))];
  const labels = info.application?.label;
  const name = (Array.isArray(labels) ? labels : [labels]).find(v => typeof v === 'string' && v.length <= 100 && !v.startsWith('resourceId:') && !v.startsWith('res/')) || null;
  parentPort.postMessage({ paths: paths.slice(0, 8), name });
} catch { parentPort.postMessage({ paths: [], name: null }); }
