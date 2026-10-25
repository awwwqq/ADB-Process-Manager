(() => {
  const table = document.querySelector('.process-table');
  const scroller = table.closest('.table-scroll');
  const headers = [...table.querySelectorAll('thead th')];
  const group = document.createElement('colgroup');
  const columns = headers.map(() => { const col = document.createElement('col'); group.append(col); return col; });
  table.prepend(group);
  const defaults = [37, 16, 12, 12, 11, 12];
  const minimums = [190, 105, 75, 95, 85, 85];
  const storageKey = 'phone-task-manager-column-widths';
  let ratios = [...defaults], gesture = null;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved) && saved.length === 6 && saved.every(n => Number.isFinite(n) && n > 0)) ratios = saved;
  } catch {}
  function widths(total) {
    const result = Array(6).fill(0); let pending = defaults.map((_, i) => i); let remaining = total;
    while (pending.length) {
      const weight = pending.reduce((sum, i) => sum + ratios[i], 0);
      const limited = pending.filter(i => remaining * ratios[i] / weight < minimums[i]);
      if (!limited.length) { for (const i of pending) result[i] = remaining * ratios[i] / weight; break; }
      for (const i of limited) { result[i] = minimums[i]; remaining -= minimums[i]; }
      pending = pending.filter(i => !limited.includes(i));
    }
    return result;
  }
  function apply(sizes) {
    columns.forEach((col, i) => col.style.width = `${sizes[i]}px`);
    headers.forEach((th, i) => th.querySelector('.column-resizer')?.setAttribute('aria-valuenow', String(Math.round(sizes[i]))));
  }
  function layout() {
    if (gesture || !scroller.clientWidth) return;
    apply(widths(Math.max(scroller.clientWidth, minimums.reduce((a, b) => a + b, 0))));
  }
  function save() { try { localStorage.setItem(storageKey, JSON.stringify(ratios)); } catch {} }
  function resize(i, pixels, start) {
    const sizes = [...start]; const pair = start[i] + start[i + 1];
    sizes[i] = Math.max(minimums[i], Math.min(pair - minimums[i + 1], start[i] + pixels));
    sizes[i + 1] = pair - sizes[i];
    apply(sizes); return sizes;
  }
  headers.slice(0, -1).forEach((header, i) => {
    const handle = document.createElement('span'); handle.className = 'column-resizer'; handle.tabIndex = 0;
    handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', `Resize ${header.textContent.replace(/[⌄↓↑]/g, '').trim()} column`);
    handle.setAttribute('aria-valuemin', String(minimums[i]));
    handle.title = 'Drag to resize. Arrow keys adjust width. Double-click to reset all columns.';
    header.append(handle);
    handle.addEventListener('click', e => e.stopPropagation());
    handle.addEventListener('dblclick', e => { e.stopPropagation(); ratios = [...defaults]; save(); layout(); });
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const start = headers.map(th => th.getBoundingClientRect().width);
      gesture = { i, x: e.clientX, start, sizes: start };
      handle.setPointerCapture(e.pointerId); handle.classList.add('dragging'); document.body.classList.add('resizing-columns');
    });
    handle.addEventListener('pointermove', e => { if (gesture?.i === i) gesture.sizes = resize(i, e.clientX - gesture.x, gesture.start); });
    function end() {
      if (gesture?.i !== i) return;
      ratios = gesture.sizes; gesture = null; save();
      handle.classList.remove('dragging'); document.body.classList.remove('resizing-columns'); layout();
    }
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end);
    handle.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const delta = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 25 : 10);
      ratios = resize(i, delta, headers.map(th => th.getBoundingClientRect().width)); save(); layout();
    });
  });
  new ResizeObserver(layout).observe(scroller);
  layout();
})();
