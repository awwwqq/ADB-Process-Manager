const $ = id => document.getElementById(id);
const state = { serial: '', info: null, snapshot: null, packages: [], view: 'processes', filter: 'all', appFilter: 'all',
  selected: null, sort: 'cpu', direction: -1, paused: false, busy: false, timer: null, samples: [], interval: 1000, native: false, mutation: false, actionError: '', performanceMetric: 'cpu', pollStarted: 0 };
try { const saved = Number(localStorage.getItem('phone-task-manager-rate')); if ([500, 1000, 4000].includes(saved)) state.interval = saved; } catch {}
const titles = { processes: ['Processes', 'See what’s running. Understand what it’s using.', 'YOUR PHONE, AT A GLANCE'],
  performance: ['Performance', 'Follow the numbers. Find the moments that matter.', 'A CLEARER PICTURE'],
  hardware: ['Hardware & sensors', 'Know the silicon. See the sensors your phone exposes.', 'INSIDE YOUR PHONE'],
  apps: ['Apps & services', 'Inspect installed packages and manage optional features.', 'TAKE CONTROL'],
  changes: ['Change history', 'Every action recorded. Every supported change reversible.', 'KNOW WHAT CHANGED'],
  settings: ['Settings & connection', 'Make yourself at home.', 'YOUR WORKSPACE'] };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, digits = 1) => Number.isFinite(n) ? n.toFixed(digits) : '—';
const gb = kb => fmt(kb / 1024 / 1024);
const color = s => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
const appIcons = new Map(), requestedIcons = new Set(), queuedIcons = new Set(); let loadingIcons = false;
function icon(name, pkg) {
  const src = pkg && appIcons.get(`${state.serial}/${pkg}`);
  if (src) return `<img class="app-icon real-icon" src="${esc(src)}" alt="${esc(name)} icon">`;
  const parts = name.replace(/^com\./, '').split(/[\s.]+/).filter(Boolean);
  return `<span class="app-icon c${color(name)}" ${pkg ? `data-icon-pkg="${esc(pkg)}"` : ''}>${esc((parts.length > 1 && !name.includes('.') ? parts[0][0] + parts[1][0] : parts[0]?.slice(0, 2) || 'SY').toUpperCase())}</span>`;
}
const iconObserver = new IntersectionObserver(entries => {
  for (const item of entries) if (item.isIntersecting) {
    const pkg = item.target.dataset.iconPkg; const key = `${state.serial}/${pkg}`;
    if (/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(pkg || '') && !requestedIcons.has(key)) { requestedIcons.add(key); queuedIcons.add(pkg); }
    iconObserver.unobserve(item.target);
  }
  loadVisibleIcons();
});
function observeIcons() { iconObserver.disconnect(); document.querySelectorAll('[data-icon-pkg]').forEach(el => iconObserver.observe(el)); }
async function loadVisibleIcons() {
  if (loadingIcons || !state.serial || !window.phone.icons || !queuedIcons.size) return;
  const visible = pkg => [...document.querySelectorAll(`[data-icon-pkg="${CSS.escape(pkg)}"]`)].some(el => {
    const box = el.getBoundingClientRect(); const root = el.closest('.table-scroll, .app-list')?.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.bottom > Math.max(0, root?.top || 0) && box.top < Math.min(innerHeight, root?.bottom || innerHeight);
  });
  const packages = [...queuedIcons].filter(visible).slice(0, 1);
  if (!packages.length) { for (const pkg of queuedIcons) requestedIcons.delete(`${state.serial}/${pkg}`); queuedIcons.clear(); return; }
  loadingIcons = true; const serial = state.serial; packages.forEach(p => queuedIcons.delete(p));
  try {
    const result = await api(window.phone.icons(serial, packages));
    for (const item of result) {
      if (!/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/=]+$/.test(item.icon || '')) continue;
      appIcons.set(`${serial}/${item.pkg}`, item.icon);
      if (serial === state.serial) document.querySelectorAll(`[data-icon-pkg="${CSS.escape(item.pkg)}"]`).forEach(el => {
        const image = document.createElement('img'); image.className = 'app-icon real-icon'; image.alt = 'App icon'; image.src = item.icon; el.replaceWith(image);
      });
    }
  } catch {} finally { loadingIcons = false; if (queuedIcons.size) loadVisibleIcons(); }
}
async function api(promise) { const r = await promise; if (!r.ok) throw new Error(r.error); return r.data; }
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
function setView(view) {
  document.querySelector('main').dataset.currentView = view;
  state.view = view; document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== `${view}View`);
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const [title, description, eyebrow] = titles[view]; $('pageTitle').textContent = title; $('pageDescription').textContent = description; $('eyebrow').textContent = eyebrow;
  $('metrics').hidden = ['changes', 'settings', 'hardware', 'performance'].includes(view);
  if (view === 'apps') loadPackages(); if (view === 'changes') renderHistory();
  if (view === 'performance') requestAnimationFrame(renderPerformance);
  if (view === 'hardware') renderHardware();
  renderMetrics();
}
async function scan() {
  try {
    const devices = await api(window.phone.devices());
    $('deviceSelect').replaceChildren();
    if (!devices.length) { const opt = new Option('No devices detected', ''); $('deviceSelect').add(opt); if (!state.serial) notice('No Android phone detected. Connect a USB data cable and enable USB debugging in Developer options.'); return; }
    for (const d of devices) $('deviceSelect').add(new Option(`${d.model} · ${d.status === 'device' ? 'USB' : d.status}`, d.serial));
    const existing = devices.find(d => d.serial === state.serial && d.status === 'device');
    if (existing) { $('deviceSelect').value = existing.serial; notice(''); return; }
    const ready = devices.find(d => d.status === 'device');
    if (ready) { $('deviceSelect').value = ready.serial; await connect(ready.serial); }
    else notice(devices.some(d => d.status === 'unauthorized') ? 'Unlock your phone and accept “Allow USB debugging?” for this PC, then scan again.' : 'Phone is offline. Reconnect the USB cable and scan again.');
  } catch (e) { notice(e.message); }
}
async function connect(serial) {
  clearTimeout(state.timer);
  try {
    $('statusText').textContent = 'Connecting to phone…';
    const info = await api(window.phone.connect(serial));
    state.serial = serial; state.info = info; state.selected = null; state.samples = []; state.snapshot = null; queuedIcons.clear(); requestedIcons.clear();
    $('processBody').replaceChildren();
    $('deviceName').textContent = info.name || info.model; $('connectionLabel').textContent = `Android ${info.android} · USB connected`;
    $('connectionLabel').classList.add('connected');
    $('settingsDevice').textContent = `${info.manufacturer} ${info.name} · Android ${info.android} · ${info.build} · ${info.serial}`;
    notice(''); await loadPackages(); await poll();
  } catch (e) { notice(e.message); $('statusText').textContent = 'Connection unavailable'; }
}
async function poll() {
  clearTimeout(state.timer);
  if (!state.serial || state.busy || state.mutation) return;
  state.busy = true; state.pollStarted = performance.now(); const serial = state.serial;
  try {
    const snapshot = await api(window.phone.snapshot(serial));
    if (serial !== state.serial) return;
    state.snapshot = snapshot; state.samples.push({ at: snapshot.at, cpu: snapshot.cpu, memory: snapshot.memory.usedPercent });
    state.samples = state.samples.filter(p => p.at >= snapshot.at - 60000);
    $('liveBadge').className = 'live-badge' + (state.paused ? '' : ' running'); $('liveBadge').innerHTML = `<span class="dot"></span>${state.paused ? 'Paused' : 'Live'}`;
    $('statusText').textContent = `${snapshot.info.name} · Android ${snapshot.info.android} · ${snapshot.rows.length} process groups`;
    $('sampleTime').textContent = `Target ${state.interval / 1000}s · measured ${snapshot.sampling?.intervalMs ? fmt(snapshot.sampling.intervalMs / 1000, 2) + 's' : 'warming up'} · ${snapshot.sampling?.durationMs || '—'}ms read`;
    $('connectionLabel').textContent = `Android ${snapshot.info.android} · USB connected`; $('connectionLabel').classList.add('connected');
    notice([state.actionError, ...snapshot.warnings].filter(Boolean).join(' · ')); renderMetrics(); renderProcesses(); if (state.view === 'performance') renderPerformance(); if (state.view === 'hardware') renderHardware();
  } catch (e) {
    notice(e.message); $('liveBadge').className = 'live-badge'; $('liveBadge').innerHTML = '<span class="dot"></span>Disconnected';
    $('connectionLabel').textContent = 'Connection interrupted'; $('connectionLabel').classList.remove('connected');
    $('statusText').textContent = 'Showing last sample · reconnect phone';
  } finally { state.busy = false; schedule(); }
}
function schedule() { clearTimeout(state.timer); if (!state.paused && state.serial && !state.busy && !state.mutation) state.timer = setTimeout(poll, Math.max(0, state.interval - (performance.now() - state.pollStarted))); }
function chart(canvasId, values, large = false, channel = 'cpu') {
  const canvas = $(canvasId); if (!canvas || !canvas.clientWidth) return;
  const ratio = window.devicePixelRatio || 1; const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * ratio; canvas.height = h * ratio; const c = canvas.getContext('2d'); c.scale(ratio, ratio);
  c.clearRect(0, 0, w, h);
  const styles = getComputedStyle(document.documentElement);
  const tint = styles.getPropertyValue(channel === 'memory' ? '--chart-memory' : '--chart-cpu').trim();
  const grid = styles.getPropertyValue('--chart-grid').trim();
  const frame = styles.getPropertyValue('--chart-frame').trim();
  const ink = styles.getPropertyValue('--chart-label').trim();
  const left = .5, right = w - .5, ceiling = .5, floor = h - .5;
  c.fillStyle = styles.getPropertyValue('--chart-bg').trim(); c.fillRect(left, ceiling, right - left, floor - ceiling);
  c.strokeStyle = grid; c.lineWidth = .5;
  for (let i = 1; i < 4; i++) { const y = ceiling + i * (floor - ceiling) / 4; c.beginPath(); c.moveTo(left, y); c.lineTo(right, y); c.stroke(); }
  for (let i = 1; i < (large ? 12 : 4); i++) { const x = left + i * (right - left) / (large ? 12 : 4); c.beginPath(); c.moveTo(x, ceiling); c.lineTo(x, floor); c.stroke(); }
  c.strokeStyle = frame; c.lineWidth = 1; c.strokeRect(left, ceiling, right - left, floor - ceiling);
  c.font = `${large ? 10 : 8}px Segoe UI`; c.fillStyle = ink; c.fillText('100%', 5, large ? 13 : 10);
  if (large) c.fillText('0%', 5, h - 6);
  const clean = values.map(v => Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null); if (!clean.some(v => v !== null)) return;
  const windowMs = large ? 60000 : 30000; const newest = state.samples.at(-1)?.at || Date.now();
  const points = clean.map((v, i) => [left + (1 - (newest - (state.samples[i]?.at || newest)) / windowMs) * (right - left), floor - (v ?? 0) / 100 * (floor - ceiling), v]).filter(p => p[0] >= left);
  const lastPoint = points.at(-1);
  if (lastPoint && lastPoint[2] !== null) { c.beginPath(); c.arc(Math.min(w - 3, lastPoint[0]), lastPoint[1], large ? 2.5 : 1.8, 0, Math.PI * 2); c.fillStyle = tint; c.fill(); }
  c.beginPath(); let started = false; for (const [x, y, v] of points) { if (v === null) { started = false; continue; } if (!started) c.moveTo(x, y); else c.lineTo(x, y); started = true; }
  c.strokeStyle = tint; c.lineWidth = large ? 1.8 : 1.5; c.stroke();
  if (points.length > 1 && points.every(p => p[2] !== null)) { const gradient = c.createLinearGradient(0, 0, 0, h); gradient.addColorStop(0, tint + '40'); gradient.addColorStop(1, tint + '05'); c.lineTo(points.at(-1)[0], h); c.lineTo(points[0][0], h); c.closePath(); c.fillStyle = gradient; c.fill(); }
}
function renderMetrics() {
  const s = state.snapshot; if (!s) return;
  $('cpuValue').textContent = fmt(s.cpu, 0); $('memoryValue').textContent = fmt(s.memory.usedPercent, 0);
  $('batteryValue').textContent = s.battery.level; $('temperatureValue').textContent = fmt(s.cpuTemperature, 0);
  $('cpuFoot').textContent = 'Total processor utilization'; $('memoryFoot').textContent = `${gb(s.memory.total - s.memory.available)} / ${gb(s.memory.total)} GB in use`;
  $('batteryFill').style.width = `${s.battery.level}%`;
  $('batteryFoot').textContent = `${s.battery.charging ? 'Charging over USB' : 'On battery'} · ${fmt(s.battery.temperature)}°C`;
  $('thermalLabel').textContent = s.thermalStatus === null ? 'Thermal status unavailable' : s.thermalStatus ? `Throttling level ${s.thermalStatus}` : 'No reported throttling';
  $('thermalFoot').textContent = s.cpuTemperature === null ? 'CPU sensor unavailable on this device' : 'Hottest current CPU sensor';
  const processor = s.info.hardware?.soc;
  if (processor) { $('cpuFoot').textContent = processor; $('cpuFoot').title = `${processor} · ${s.info.hardware.cores || '?'} cores`; }
  chart('cpuSpark', state.samples.map(s => s.cpu)); chart('memorySpark', state.samples.map(s => s.memory), false, 'memory');
}
function filteredRows() {
  const query = $('processSearch').value.toLowerCase();
  return (state.snapshot?.rows || []).filter(r => (state.native || r.pkg || ['system_server', 'surfaceflinger'].includes(r.process)) &&
    (state.filter === 'all' || state.filter === 'apps' && !r.system || state.filter === 'background' && r.state === 'Background' || state.filter === 'system' && r.system) &&
    `${r.name} ${r.pkg || r.process}`.toLowerCase().includes(query)).sort((a, b) => {
      const x = state.sort === 'count' ? a.pids.length : a[state.sort]; const y = state.sort === 'count' ? b.pids.length : b[state.sort];
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * state.direction || a.name.localeCompare(b.name);
    });
}
function renderProcesses() {
  const rows = filteredRows(); $('navCount').textContent = state.snapshot?.rows.filter(r => r.pkg).length ?? '—';
  const body = $('processBody'); const existing = new Map([...body.children].map(tr => [tr.dataset.id, tr]));
  const update = (element, text) => { if (element.textContent !== text) element.textContent = text; };
  rows.forEach((r, index) => {
    let tr = existing.get(r.id); existing.delete(r.id);
    if (!tr) {
      tr = document.createElement('tr'); tr.dataset.id = r.id; tr.tabIndex = 0;
      tr.innerHTML = `<td><div class="app-identity">${icon(r.name, r.pkg)}<div class="app-identity-text"><div class="app-name">${esc(r.name)}</div><div class="package-name" title="${esc(r.pkg || r.process)}">${esc(r.pkg || r.process)}</div></div></div></td><td><span class="state"></span></td><td class="number-col cpu-cell"></td><td class="number-col"><span class="ram-value"></span> <span class="type-tag">MB</span></td><td class="count-col"></td><td><span class="type-tag">${r.system ? 'System' : 'User app'}</span></td>`;
    }
    tr.classList.toggle('selected', state.selected === r.id); tr.setAttribute('aria-selected', String(state.selected === r.id));
    const status = tr.children[1].firstElementChild; status.className = `state ${r.state.toLowerCase()}`; update(status, r.state);
    update(tr.children[2], `${fmt(r.cpu)}%`); update(tr.querySelector('.ram-value'), fmt(r.memory, 0)); update(tr.children[4], String(r.pids.length));
    if (body.children[index] !== tr) body.insertBefore(tr, body.children[index] || null);
  });
  for (const tr of existing.values()) tr.remove();
  $('processEmpty').hidden = rows.length > 0;
  if (state.snapshot && !rows.length) $('processEmpty').innerHTML = '<div class="empty-icon">⌕</div><h2>No matching processes</h2><p>Try a different search or filter.</p>';
  $('processCount').textContent = `${rows.length} groups · ${rows.reduce((n, r) => n + r.pids.length, 0)} processes`;
  renderSelection();
  observeIcons();
}
function renderSelection() {
  const row = state.snapshot?.rows.find(r => r.id === state.selected);
  if (!row) { state.selectionMarkup = null; $('selectionPanel').innerHTML = '<div class="selection-placeholder"><span>ⓘ</span><span>Select a process to see its details and available actions.</span></div>'; return; }
  const actions = [];
  if (row.pkg && !row.protected) {
    if (!row.system) actions.push(['stop', 'Force stop']);
    if (!row.system || row.optional) actions.push(['disable', 'Disable app']);
    if (row.optional) actions.push(['remove', 'Remove for user']);
  }
  const markup = `<div class="selection-detail"><div class="selection-title">${esc(row.name)}${row.protected ? '<span class="tiny-tag">Protected</span>' : ''}</div><div class="selection-sub">${esc(row.note || `${row.state} · PID${row.pids.length > 1 ? 's' : ''}: ${row.pids.join(', ')} · ${row.system ? 'System package; inspect dependencies before changing it.' : 'Force stop can interrupt notifications and unsaved work.'}`)}</div></div><div class="selection-actions">${actions.map(([a, text]) => `<button class="button ${a === 'remove' ? 'danger' : 'secondary'}" data-action="${a}" data-pkg="${esc(row.pkg)}" ${state.mutation ? 'disabled' : ''}>${text}</button>`).join('') || '<span class="type-tag">Inspection only</span>'}</div>`;
  if (state.selectionMarkup !== markup) { $('selectionPanel').innerHTML = markup; state.selectionMarkup = markup; }
}
function renderPerformance() {
  const s = state.snapshot; if (!s) return;
  const memory = state.performanceMetric === 'memory'; const hw = s.info.hardware || {};
  document.querySelectorAll('[data-performance]').forEach(b => { const selected = b.dataset.performance === state.performanceMetric; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); });
  $('performanceCpuValue').textContent = `${fmt(s.cpu)}%`; $('performanceMemoryValue').textContent = `${fmt(s.memory.usedPercent)}%`;
  $('focusTitle').textContent = memory ? 'Memory' : 'CPU';
  $('cpuChartDescription').textContent = memory ? `${gb(s.memory.total)} GB physical memory` : `${hw.soc || 'Processor'} · ${hw.cores || '?'} cores`;
  $('focusValue').textContent = `${fmt(memory ? s.memory.usedPercent : s.cpu)}%`;
  $('focusSubtitle').textContent = memory ? 'Physical RAM utilization · available cache is reclaimable' : 'Total processor utilization · normalized across all cores';
  chart('focusedChart', state.samples.map(s => memory ? s.memory : s.cpu), true, memory ? 'memory' : 'cpu');
  chart('performanceCpuSpark', state.samples.map(s => s.cpu)); chart('performanceMemorySpark', state.samples.map(s => s.memory), false, 'memory');
  const details = memory ? [
    ['In use', `${gb(s.memory.total - s.memory.available)} GB`], ['Available', `${gb(s.memory.available)} GB`], ['Physical RAM', `${gb(s.memory.total)} GB`],
    ['Cached pages', s.memory.cached == null ? 'Not reported' : `${gb(s.memory.cached)} GB`], ['Free pages', s.memory.free == null ? 'Not reported' : `${gb(s.memory.free)} GB`],
    ['Compressed swap (logical)', `${gb(s.memory.swapUsed)} / ${gb(s.memory.swapTotal)} GB`]
  ] : [
    ['Utilization', `${fmt(s.cpu)}%`], ['CPU0 clock', s.cpu0MHz ? `${fmt(s.cpu0MHz / 1000, 2)} GHz` : 'Not reported'], ['CPU cores', hw.cores || s.coreUsage?.length || 'Not reported'],
    ['Architecture', hw.abi || 'Not reported'], ['App processes', s.rows.filter(r => r.pkg).reduce((sum, r) => sum + r.pids.length, 0)],
    ['Uptime', `${Math.floor(s.uptime / 86400)}d ${Math.floor(s.uptime % 86400 / 3600)}h`]
  ];
  $('performanceDetails').innerHTML = details.map(([label, value]) => `<div><div class="detail-label">${esc(label)}</div><div class="detail-value">${esc(value)}</div></div>`).join('');
  $('cpuCoreSection').hidden = memory; $('memoryComposition').hidden = !memory;
  $('cpuCores').innerHTML = (s.coreUsage || []).map(c => `<div class="cpu-core"><span>${esc(c.name.replace('cpu', 'Core '))}</span><strong>${fmt(c.usage)}%</strong><meter min="0" max="100" value="${Number.isFinite(c.usage) ? c.usage : 0}" aria-label="${esc(c.name)} utilization"></meter></div>`).join('') || '<p class="muted">Per-core counters unavailable.</p>';
  $('memoryUsedMeter').value = s.memory.usedPercent || 0;
  $('memoryCompositionText').textContent = `${gb(s.memory.total - s.memory.available)} GB in use · ${gb(s.memory.available)} GB available`;
  $('performanceSampling').textContent = `60-second history · Target ${state.interval / 1000}s · measured ${s.sampling?.intervalMs ? fmt(s.sampling.intervalMs / 1000, 2) + 's' : 'warming up'} · read ${s.sampling?.durationMs || '—'}ms. App states, clocks and hardware sensors refresh about every 4 seconds.`;
}
function renderHardware() {
  const s = state.snapshot; const hw = s?.info.hardware;
  if (!hw) { $('hardwareCards').innerHTML = '<div class="panel empty-state"><h2>Connect a phone to discover its hardware</h2></div>'; return; }
  const thermals = s.thermals || []; const gpus = thermals.filter(t => t.type === 1); const npus = thermals.filter(t => t.type === 9);
  const hottest = entries => entries.length ? `${fmt(Math.max(...entries.map(t => t.value)))} °C` : 'Not reported';
  const cards = [
    ['CPU / system on chip', hw.soc, `${hw.socId || 'Unknown ID'} · ${hw.cores || '?'} cores · ${hw.abi}`, hw.cpu],
    ['Graphics processor', hw.gpu, `${hw.gpuSource} · ${hottest(gpus)}`, `Utilization: ${s.gpu?.usage === null ? 'Unavailable on this firmware' : fmt(s.gpu?.usage) + '%'} · Clock: ${s.gpu?.clockMHz ? fmt(s.gpu.clockMHz, 0) + ' MHz' : 'Unavailable'}`],
    [hw.acceleratorKind, hw.accelerator || 'Not identified', hw.accelerator ? 'Identified from chipset specification' : 'No separate NPU / APU name reported', `${npus.length} NPU thermal channels · ${hottest(npus)} · Utilization unavailable`]
  ];
  $('hardwareCards').innerHTML = cards.map(([kind, name, meta, detail]) => `<div class="panel hardware-card"><div class="eyebrow">${esc(kind)}</div><h2>${esc(name)}</h2><p>${esc(meta)}</p><div class="hardware-note">${esc(detail)}</div></div>`).join('');
  $('thermalCount').textContent = `${thermals.length} live channels`;
  $('thermalSensors').innerHTML = thermals.map(t => `<div class="sensor-tile"><div><strong>${esc(t.name)}</strong><span>${esc(t.group)}</span></div><div class="sensor-value">${fmt(t.value, t.unit === 'V' ? 3 : 1)}<small>${esc(t.unit)}</small></div></div>`).join('') || '<p class="muted">This phone does not expose current thermal channels through ADB.</p>';
  const sensors = s.info.sensors || [];
  $('deviceSensorCount').textContent = `${sensors.length} reported entries`;
  $('deviceSensors').innerHTML = sensors.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(t.vendor)}</td><td>${esc(t.type.replace('android.sensor.', ''))}</td></tr>`).join('') || '<tr><td colspan="3">No device sensor inventory exposed.</td></tr>';
}
function applyTheme(theme) {
  const chosen = theme === 'light' ? 'light' : 'dark'; document.documentElement.dataset.theme = chosen;
  try { localStorage.setItem('phone-task-manager-theme', chosen); } catch {}
  if (window.phone.theme) window.phone.theme(chosen).catch(() => {});
  $('themeToggle').textContent = chosen === 'dark' ? '☼ Light' : '☾ Dark';
  $('themeToggle').setAttribute('aria-label', `Switch to ${chosen === 'dark' ? 'light' : 'dark'} mode`);
  $('themeToggle').setAttribute('aria-pressed', String(chosen === 'light'));
  document.querySelectorAll('[data-theme-choice]').forEach(b => { const selected = b.dataset.themeChoice === chosen; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); });
  renderMetrics(); if (state.view === 'performance') renderPerformance();
}
async function loadPackages() { if (!state.serial) { renderApps(); return; } try { state.packages = await api(window.phone.packages(state.serial)); renderApps(); } catch (e) { notice(e.message); } }
function renderApps() {
  const query = $('appSearch').value.toLowerCase();
  const packages = state.packages.filter(p => (state.appFilter === 'all' || state.appFilter === 'user' && !p.system || state.appFilter === 'system' && p.system || state.appFilter === 'removed' && (!p.installed || p.disabled)) && `${p.name} ${p.pkg}`.toLowerCase().includes(query)).sort((a, b) => Number(b.optional) - Number(a.optional) || a.name.localeCompare(b.name));
  $('appList').innerHTML = packages.map(p => {
    const actions = !p.installed ? [['restore', 'Restore']] : p.disabled ? [['enable', 'Re-enable']] : !p.protected && (!p.system || p.optional) ? [['disable', 'Disable'], ...(p.optional ? [['remove', 'Remove for user']] : [])] : [];
    return `<div class="app-row"><div class="app-identity">${icon(p.name, p.pkg)}<div class="app-identity-text"><div class="app-name">${esc(p.name)} ${p.optional ? '<span class="tiny-tag">Reviewed extra</span>' : ''}</div><div class="package-name" title="${esc(p.note || p.pkg)}">${esc(p.pkg)}</div></div></div><span class="type-tag">${p.system ? 'System' : 'User app'}</span><span class="app-state">${!p.installed ? 'Removed' : p.disabled ? 'Disabled' : 'Installed'}</span><div class="app-actions">${actions.map(([a, text]) => `<button class="button secondary" data-action="${a}" data-pkg="${esc(p.pkg)}" ${state.mutation ? 'disabled' : ''}>${text}</button>`).join('') || '<span class="type-tag">Protected / inspect only</span>'}</div></div>`;
  }).join('') || '<div class="empty-state"><h2>No apps to show</h2><p>Connect a phone or adjust your filters.</p></div>';
  observeIcons();
}
async function renderHistory() {
  try {
    const history = await api(window.phone.history());
    const verbs = { stop: 'Force stopped', disable: 'Disabled', remove: 'Removed for user', restore: 'Restored', enable: 'Re-enabled' };
    $('historyList').innerHTML = history.map(h => `<div class="panel history-card"><span class="history-badge ${h.status !== 'success' ? 'failed' : ''}">${esc(h.restoredAt ? 'Restored' : h.status)}</span><div class="history-content"><h3>${esc(verbs[h.action] || h.action)} · ${esc(h.name)}</h3><p>${esc(h.pkg)} · ${esc(h.serial)} · ${esc(new Date(h.at).toLocaleString())}</p>${h.status !== 'success' ? `<p>${esc(h.output || 'Action started; final result was not recorded. Check current package state in Apps before retrying.')}</p>` : ''}</div>${h.status === 'success' && !h.restoredAt && ['disable', 'remove'].includes(h.action) ? `<button class="button secondary" data-undo="${esc(h.id)}" ${state.mutation ? 'disabled' : ''}>↶ Restore</button>` : ''}</div>`).join('') || '<div class="panel empty-state"><div class="empty-icon">↶</div><h2>A clean slate.</h2><p>Actions you take in this app will appear here.<br>Earlier changes made outside this app are listed in Apps & services.</p></div>';
  } catch (e) { notice(e.message); }
}
async function action(pkg, action, undoId) {
  if (state.mutation) return;
  state.mutation = true; state.actionError = ''; notice(''); clearTimeout(state.timer); renderSelection(); renderApps();
  try {
    const result = await api(undoId ? window.phone.undo(undoId) : window.phone.action({ serial: state.serial, pkg, action }));
    if (!result.cancelled) toast('Action completed. The package state has been verified.');
    await loadPackages(); if (state.view === 'changes') await renderHistory();
  } catch (e) { state.actionError = e.message; notice(e.message); if (state.view === 'changes') await renderHistory(); }
  finally { state.mutation = false; renderApps(); renderSelection(); if (state.view === 'changes') await renderHistory(); await poll(); }
}
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-view]'); if (nav) setView(nav.dataset.view);
  const row = e.target.closest('tr[data-id]'); if (row) { state.selected = row.dataset.id; renderProcesses(); }
  const act = e.target.closest('[data-action]'); if (act) action(act.dataset.pkg, act.dataset.action);
  const undo = e.target.closest('[data-undo]'); if (undo) action(null, null, undo.dataset.undo);
  const metric = e.target.closest('[data-metric]'); if (metric) { if (['cpu', 'memory'].includes(metric.dataset.metric)) state.performanceMetric = metric.dataset.metric; setView(metric.dataset.metric === 'thermal' ? 'hardware' : 'performance'); }
  const focus = e.target.closest('[data-performance]'); if (focus) { state.performanceMetric = focus.dataset.performance; renderPerformance(); }
  const theme = e.target.closest('[data-theme-choice]'); if (theme) applyTheme(theme.dataset.themeChoice);
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (state.view !== 'apps') setView('processes'); $(state.view === 'apps' ? 'appSearch' : 'processSearch').focus(); }
  if (e.key === 'Enter' && e.target.matches('tr[data-id]')) { state.selected = e.target.dataset.id; renderProcesses(); }
});
for (const id of ['refreshDevices', 'emptyScan', 'settingsScan']) $(id).addEventListener('click', scan);
$('deviceSelect').addEventListener('change', e => { if (e.target.value) connect(e.target.value); });
$('refresh').addEventListener('click', () => state.serial ? poll() : scan());
$('pause').addEventListener('click', () => { state.paused = !state.paused; $('pause').textContent = state.paused ? '▷ Resume' : 'Ⅱ Pause'; $('interval').value = state.paused ? '0' : String(state.interval); $('liveBadge').className = 'live-badge' + (state.paused ? '' : ' running'); $('liveBadge').innerHTML = `<span class="dot"></span>${state.paused ? 'Paused' : 'Live'}`; if (state.paused) clearTimeout(state.timer); else poll(); });
$('processSearch').addEventListener('input', renderProcesses); $('appSearch').addEventListener('input', renderApps);
for (const [id, key, render] of [['processFilters', 'filter', renderProcesses], ['appFilters', 'appFilter', renderApps]]) $(id).addEventListener('click', e => { const b = e.target.closest('[data-filter]'); if (!b) return; state[key] = b.dataset.filter; $(id).querySelectorAll('button').forEach(x => x.classList.toggle('selected', x === b)); render(); });
document.querySelectorAll('[data-sort]').forEach(th => th.addEventListener('click', () => { state.direction = state.sort === th.dataset.sort ? -state.direction : ['name', 'state'].includes(th.dataset.sort) ? 1 : -1; state.sort = th.dataset.sort; document.querySelectorAll('[data-sort]').forEach(h => { h.classList.toggle('sorted', h === th); const span = h.querySelector('span:not(.column-resizer)'); if (span) span.textContent = h === th ? state.direction === -1 ? '↓' : '↑' : ''; }); renderProcesses(); }));
$('interval').value = String(state.interval);
$('interval').addEventListener('change', e => {
  const interval = Number(e.target.value); state.paused = interval === 0;
  if (interval) { state.interval = interval; try { localStorage.setItem('phone-task-manager-rate', String(interval)); } catch {} }
  $('pause').textContent = state.paused ? '▷ Resume' : 'Ⅱ Pause';
  $('liveBadge').className = 'live-badge' + (state.paused ? '' : ' running'); $('liveBadge').innerHTML = `<span class="dot"></span>${state.paused ? 'Paused' : 'Live'}`;
  if (state.paused) clearTimeout(state.timer); else schedule();
});
$('nativeToggle').addEventListener('change', e => { state.native = e.target.checked; renderProcesses(); });
for (const id of ['minimize', 'maximize', 'close']) $(id).addEventListener('click', () => window.phone.window(id));
window.addEventListener('resize', () => { renderMetrics(); if (state.view === 'performance') renderPerformance(); });
$('themeToggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
applyTheme(document.documentElement.dataset.theme);
scan();
