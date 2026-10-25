// Deterministic Electron UI regression test. IPC reads use fixtures and phone
// mutation handlers are replaced with rejections before the page is reloaded.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.cache'); fs.mkdirSync(cache, { recursive: true });
const profile = fs.mkdtempSync(path.join(cache, 'ui-layout-'));
const info = { serial: 'TEST-DEVICE', name: 'Test Android phone', model: 'Test', android: '16', manufacturer: 'Test', build: 'Test build',
  hardware: { soc: 'Qualcomm Snapdragon 8s Gen 3', cores: 8 }, sensors: [] };
const rows = Array.from({ length: 90 }, (_, i) => ({ id: `com.example.app${i}`, pkg: `com.example.app${i}`, name: `Example app ${i}`,
  pids: [1000 + i], cpu: i / 10, memory: 100 + i, state: i % 2 ? 'Cached' : 'Background', system: false, protected: false }));
const fixture = { info, rows, cpu: 7.5, memory: { total: 8000000, available: 2200000, usedPercent: 72.5, swapTotal: 4000000, swapUsed: 1500000 },
  battery: { level: 49, temperature: 32.4, charging: true }, cpuTemperature: 43, thermalStatus: 0,
  storage: { total: 250000000, free: 60000000 }, uptime: 86400, warnings: [] };
(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, `--user-data-dir=${profile}`], env });
  try {
    const page = await app.firstWindow(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await app.evaluate(({ ipcMain }, fixture) => {
      for (const channel of ['devices', 'connect', 'snapshot', 'packages', 'history', 'action', 'undo']) ipcMain.removeHandler(channel);
      ipcMain.handle('devices', () => ({ ok: true, data: [{ serial: 'TEST-DEVICE', status: 'device', model: 'Test' }] }));
      ipcMain.handle('connect', () => ({ ok: true, data: fixture.info }));
      ipcMain.handle('snapshot', () => ({ ok: true, data: { ...fixture, at: Date.now() } }));
      ipcMain.handle('packages', () => ({ ok: true, data: [] }));
      ipcMain.handle('history', () => ({ ok: true, data: [] }));
      for (const channel of ['action', 'undo']) ipcMain.handle(channel, () => ({ ok: false, error: 'Phone actions are disabled in the layout test.' }));
    }, fixture);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#deviceName').textContent === 'Test Android phone' && document.querySelectorAll('#processBody tr').length === 90);
    await page.locator('#pause').click();
    const heights = [];
    for (const [width, height] of [[1350, 880], [1350, 1440], [1060, 680], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => document.querySelector('.process-table col').style.width !== '');
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const bounds = await page.evaluate(() => {
        const rect = el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
        return { metrics: [...document.querySelectorAll('.metric[data-metric="cpu"], .metric[data-metric="memory"]')].map(card => ({
          card: rect(card), value: rect(card.querySelector('.metric-value')), graph: rect(card.querySelector('canvas')), foot: rect(card.querySelector('.metric-foot')) })),
          table: rect(document.querySelector('.table-scroll')), selection: rect(document.querySelector('#selectionPanel')), footer: rect(document.querySelector('.statusbar')),
          scrollHeight: document.querySelector('main').scrollHeight, clientHeight: document.querySelector('main').clientHeight };
      });
      for (const metric of bounds.metrics) {
        assert.ok(metric.graph.bottom <= metric.foot.top - 4, `Graph overlaps caption at ${width} × ${height}`);
        assert.ok(metric.value.right <= metric.graph.left - 4, `Value overlaps graph at ${width} × ${height}`);
        assert.ok(metric.foot.bottom <= metric.card.bottom - 8, 'Caption outside card');
      }
      assert.ok(bounds.footer.top - bounds.selection.bottom < 20, 'Unused space beneath process panel');
      assert.ok(bounds.footer.bottom <= height + 1, 'Status bar clipped');
      assert.ok(bounds.scrollHeight <= bounds.clientHeight + 1, 'Main container scrolls instead of process list');
      heights.push(bounds.table.height);
      await page.screenshot({ path: path.join(cache, `layout-${width}x${height}.png`) });
    }
    assert.ok(heights[1] - heights[0] > 500, 'Process list did not expand with taller window');
    await page.setViewportSize({ width: 1350, height: 880 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const statusHeader = page.locator('th[data-sort="state"]');
    const before = (await statusHeader.boundingBox()).width;
    const sortBefore = await page.locator('th.sorted').getAttribute('data-sort');
    const handle = page.getByRole('separator', { name: 'Resize Status column' });
    const grip = await handle.boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down(); await page.mouse.move(grip.x + grip.width / 2 + 25, grip.y + grip.height / 2, { steps: 8 }); await page.mouse.up();
    const after = (await statusHeader.boundingBox()).width;
    assert.ok(after - before > 20 && after - before < 30, 'Dragging did not resize Status column');
    assert.equal(await page.locator('th.sorted').getAttribute('data-sort'), sortBefore, 'Resize unexpectedly sorted the column');
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#processBody tr').length === 90);
    assert.ok(Math.abs((await statusHeader.boundingBox()).width - after) < 2, 'Column width did not persist');
    await handle.focus(); await page.keyboard.press('ArrowLeft');
    assert.ok((await statusHeader.boundingBox()).width < after - 5, 'Keyboard resize failed');
    await handle.dblclick();
    assert.ok(Math.abs((await statusHeader.boundingBox()).width - before) < 2, 'Double-click reset failed');
    await page.locator('#themeToggle').click();
    await page.screenshot({ path: path.join(cache, 'layout-light.png') });
    assert.deepEqual(errors, [], 'Renderer errors');
    console.log('UI regression passed: no card overlaps, full-height process list, four window sizes, pointer and keyboard column resizing, persistence, reset, light theme. Phone actions disabled.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
