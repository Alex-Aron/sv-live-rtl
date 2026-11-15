/* Shared navigation for live schematics and hierarchical project snapshots. */
window.rtlCreateViewport = (canvas, vscode) => {
  const initial = vscode.getState?.()?.viewport;
  const MIN = 0.05, MAX = 8;
  let content, zoom = Number(initial?.zoom) || 1, fitMode = initial?.fit !== false;
  let drag;
  const label = document.getElementById('zoom-level');
  const clamp = value => Math.min(MAX, Math.max(MIN, value));
  const capture = () => ({ zoom, left: canvas.scrollLeft, top: canvas.scrollTop, fit: fitMode });
  const persist = () => vscode.setState({ ...(vscode.getState?.() || {}), viewport: capture() });
  const paint = () => {
    if (content) content.style.zoom = zoom;
    if (label) label.textContent = Math.round(zoom * 100) + '%';
  };
  function setZoom(value, clientX, clientY) {
    if (!content) return;
    const bounds = canvas.getBoundingClientRect();
    const x = clientX ?? bounds.left + canvas.clientWidth / 2;
    const y = clientY ?? bounds.top + canvas.clientHeight / 2;
    const before = content.getBoundingClientRect();
    const localX = (x - before.left) / zoom, localY = (y - before.top) / zoom;
    zoom = clamp(value); fitMode = false; paint();
    const after = content.getBoundingClientRect();
    canvas.scrollLeft += after.left + localX * zoom - x;
    canvas.scrollTop += after.top + localY * zoom - y;
    persist();
  }
  function fit() {
    if (!content) return;
    // Undo the current scale to measure the natural diagram, including its frame.
    const bounds = content.getBoundingClientRect();
    const w = bounds.width / zoom, h = bounds.height / zoom;
    if (!w || !h) return;
    zoom = clamp(Math.min(1, (canvas.clientWidth - 40) / w, (canvas.clientHeight - 40) / h));
    fitMode = true; paint(); canvas.scrollLeft = 0; canvas.scrollTop = 0; persist();
  }
  function restore(position) {
    if (!position) return;
    zoom = clamp(position.zoom); fitMode = position.fit; paint();
    if (fitMode) fit();
    else { canvas.scrollLeft = position.left; canvas.scrollTop = position.top; persist(); }
  }
  function setContent(element, options = {}) {
    content = element;
    paint();
    if (options.fit) fit();
    else restore(options.position || initial || capture());
  }
  const zoomBy = factor => setZoom(zoom * factor);
  document.getElementById('zoom-in')?.addEventListener('click', () => zoomBy(1.2));
  document.getElementById('zoom-out')?.addEventListener('click', () => zoomBy(1 / 1.2));
  document.getElementById('zoom-fit')?.addEventListener('click', fit);
  document.getElementById('zoom-reset')?.addEventListener('click', () => setZoom(1));
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'RTL schematic. Wheel or pinch to zoom; drag to pan. Plus/minus zoom, F fits, 0 resets.');
  canvas.addEventListener('wheel', event => {
    if (!content || event.target.closest?.('select,input,textarea')) return;
    event.preventDefault();
    if ((event.shiftKey || !event.deltaY && event.deltaX) && !event.ctrlKey && !event.metaKey) {
      canvas.scrollLeft += event.deltaX || event.deltaY;
      canvas.scrollTop += event.deltaX ? event.deltaY : 0;
      fitMode = false; persist(); return;
    }
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    const delta = Math.max(-120, Math.min(120, event.deltaY * unit));
    setZoom(zoom * Math.exp(-delta * 0.003), event.clientX, event.clientY);
  }, { passive: false });
  canvas.addEventListener('pointerdown', event => {
    if (!content || ![0, 1].includes(event.button) || event.target.closest?.('button,input,select,textarea,a,summary,[role="button"]')) return;
    canvas.focus({ preventScroll: true });
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: canvas.scrollLeft, top: canvas.scrollTop };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('panning');
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    canvas.scrollLeft = drag.left - (event.clientX - drag.x);
    canvas.scrollTop = drag.top - (event.clientY - drag.y);
    fitMode = false; persist();
  });
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    drag = undefined; canvas.classList.remove('panning');
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', () => { drag = undefined; canvas.classList.remove('panning'); });
  canvas.addEventListener('keydown', event => {
    if (event.target.closest?.('input,select,textarea,button,summary,[role="button"],[contenteditable="true"]')) return;
    if ((event.ctrlKey || event.metaKey || event.altKey) && !['+', '=', '-', '_', '0'].includes(event.key)) return;
    let handled = true;
    if (event.key === '+' || event.key === '=') zoomBy(1.2);
    else if (event.key === '-' || event.key === '_') zoomBy(1 / 1.2);
    else if (event.key === '0') setZoom(1);
    else if (event.key.toLowerCase() === 'f') fit();
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      const step = event.shiftKey ? 240 : 60;
      canvas.scrollLeft += event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      canvas.scrollTop += event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      fitMode = false; persist();
    } else handled = false;
    if (handled) event.preventDefault();
  });
  canvas.addEventListener('scroll', () => { if (content) persist(); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (fitMode) fit(); }).observe(canvas);
  paint();
  return { setContent, capture, restore, fit, zoomBy, get hasContent() { return !!content; } };
};
