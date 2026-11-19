/* Draggable RTL schematic blocks for both Live and Project viewers.
 *
 * Every <g> with an s:type attribute or an id starting with cell_ becomes
 * draggable via left-mouse drag.  The module preserves offsets across live
 * re-synthesis updates and project-viewer mutations through an in-memory
 * offset map and a MutationObserver.
 *
 * Integrates with viewport.js panning by intercepting pointerdown in the
 * capture phase and stopping propagation only when a draggable block is hit.
 */
window.rtlInitDragBlocks = (() => {
  /* ---- offset store (survives re-renders within the same webview session) ---- */
  const offsets = new Map();          // id -> { dx, dy }

  /* ---- helpers ---- */
  function isDraggableCandidate(el, portsOnly) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName !== 'g' && el.tagName !== 'G') return false;
    if (portsOnly) return ['inputExt', 'outputExt', 'constant'].includes(el.getAttribute('s:type'));
    if (el.hasAttribute('s:type')) return true;
    const id = el.getAttribute('id') || el.dataset?.originalId || '';
    return /^(project-\d+-)?cell_/.test(id);
  }

  function findDraggable(target) {
    let el = target;
    while (el && el.id !== 'canvas') {
      if (el.classList?.contains('project-toggle')) return null;   // never intercept toggles
      if (el.getAttribute?.('data-draggable') === 'true') return el;
      el = el.parentNode;
    }
    return null;
  }

  function parseTranslate(transform) {
    const m = /translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/.exec(transform || '');
    return m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 };
  }

  function translated(original, x, y) {
    const value = `translate(${x}, ${y})`;
    return /translate\([^)]*\)/.test(original) ? original.replace(/translate\([^)]*\)/, value) : value + (original ? ' ' + original : '');
  }

  function offsetKey(block) {
    // Use data-originalId when present (project-viewer prefixed IDs change on
    // each re-render); fall back to the actual id.
    const id = block.dataset?.originalId || block.getAttribute('id') || [...block.parentNode.children].indexOf(block).toString();
    // For project-viewer nested instances, include the parent module's
    // originalId to disambiguate the same cell name in different modules.
    const parentSvg = block.closest?.('svg');
    const path = parentSvg?.dataset?.instancePath || '';
    return path ? path + '/' + id : id;
  }

  // Connect the original routed endpoint to the current pin location. The
  // existing route, including branches and crossing decorations, stays intact.
  const leads = new WeakMap();
  function refreshLeads(block) {
    const svg = block.closest('svg');
    if (!svg?.createSVGPoint || !block.getScreenCTM || !svg.getScreenCTM) return;
    let entries = leads.get(block);
    if (!entries) {
      entries = [];
      const matrix = block.getScreenCTM();
      if (!matrix) return;
      const current = parseTranslate(block.getAttribute('transform'));
      const original = parseTranslate(block.getAttribute('data-orig-transform'));
      const pins = [...block.querySelectorAll('[s\\:pid]')].filter(pin => pin.closest('svg') === svg && pin.closest('[data-draggable="true"]') === block);
      for (const pin of pins) {
        const px = Number(pin.getAttribute('s:x')), py = Number(pin.getAttribute('s:y'));
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        const pt = svg.createSVGPoint(); pt.x = px; pt.y = py;
        const screen = pt.matrixTransform(matrix);
        // Compensate for an offset already restored on this block.
        const zero = svg.createSVGPoint(); zero.x = 0; zero.y = 0;
        const delta = svg.createSVGPoint(); delta.x = current.x - original.x; delta.y = current.y - original.y;
        const parentMatrix = block.parentNode.getScreenCTM();
        const a = zero.matrixTransform(parentMatrix), b = delta.matrixTransform(parentMatrix);
        const target = { x: screen.x - (b.x - a.x), y: screen.y - (b.y - a.y) };
        for (const line of svg.querySelectorAll('line[class*="net_"]')) {
          if (line.closest('svg') !== svg || !line.getScreenCTM()) continue;
          for (const end of [1, 2]) {
            const p = svg.createSVGPoint(); p.x = Number(line.getAttribute('x' + end)); p.y = Number(line.getAttribute('y' + end));
            const at = p.matrixTransform(line.getScreenCTM());
            if (Math.hypot(at.x - target.x, at.y - target.y) > 1) continue;
            const lead = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            lead.setAttribute('class', (line.getAttribute('class') || '') + ' rtl-drag-lead');
            lead.setAttribute('fill', 'none');
            svg.appendChild(lead);
            entries.push({ lead, px, py, x: p.x, y: p.y, line });
          }
        }
      }
      leads.set(block, entries);
    }
    const inv = svg.getScreenCTM()?.inverse();
    if (!inv) return;
    for (const entry of entries) {
      const pin = svg.createSVGPoint(); pin.x = entry.px; pin.y = entry.py;
      const end = pin.matrixTransform(block.getScreenCTM()).matrixTransform(inv);
      const start = svg.createSVGPoint(); start.x = entry.x; start.y = entry.y;
      const from = start.matrixTransform(entry.line.getScreenCTM()).matrixTransform(inv);
      entry.lead.setAttribute('d', `M${from.x},${from.y} L${end.x},${from.y} L${end.x},${end.y}`);
    }
  }

  /* ---- mark & restore a single block ---- */
  function markBlock(block) {
    if (block.getAttribute('data-draggable') === 'true') return;
    block.setAttribute('data-draggable', 'true');

    const current = block.getAttribute('transform') || '';
    block.setAttribute('data-orig-transform', current);

    // Restore a saved offset if one exists.
    const key = offsetKey(block);
    const saved = offsets.get(key);
    if (saved) {
      const base = parseTranslate(current);
      block.setAttribute('transform', translated(current, base.x + saved.dx, base.y + saved.dy));
      refreshLeads(block);
    }
  }

  /* ---- scan an element tree and mark all draggable blocks ---- */
  function scanAndMark(root, portsOnly) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    // Check root itself
    if (isDraggableCandidate(root, portsOnly)) markBlock(root);
    // Check descendants: g elements with s:type or cell_ ids
    const groups = root.querySelectorAll('g');
    for (let i = 0; i < groups.length; i++) {
      if (isDraggableCandidate(groups[i], portsOnly)) markBlock(groups[i]);
    }
  }

  /* ---- drag state ---- */
  let dragState = null;   // { block, pointerId, startSVG, baseTx, baseTy, svgPt, ctmInv }

  /* ---- main initializer ---- */
  return function initDragBlocks(canvas, portsOnly = false) {
    if (!canvas) return;

    // Initial scan for any SVG already in the canvas.
    const scan = root => scanAndMark(root, portsOnly);
    scan(canvas);

    /* -- MutationObserver: catches project-viewer async DOM updates -- */
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          scan(node);
        }
      }
    });
    observer.observe(canvas, { childList: true, subtree: true });

    const dragToggle = document.getElementById('toggle-block-drag');
    if (dragToggle) {
      canvas.classList.toggle('block-drag-disabled', !dragToggle.checked);
    }
    dragToggle?.addEventListener('change', () => {
      canvas.classList.toggle('block-drag-disabled', !dragToggle.checked);
    });

    /* -- Capture-phase pointerdown: intercept before viewport panning -- */
    canvas.addEventListener('pointerdown', e => {
      if (dragToggle && !dragToggle.checked) return;
      if (e.button !== 0) return;                        // left-click only
      const block = findDraggable(e.target);
      if (!block) return;                                // let viewport.js handle

      e.stopPropagation();
      e.preventDefault();

      const svg = block.closest('svg');
      if (!svg) return;

      // Build a CTM that converts screen coords → parent SVG user-space.
      const ctm = (block.parentNode?.getScreenCTM?.() || svg.getScreenCTM())?.inverse();
      if (!ctm) return;

      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const startSVG = pt.matrixTransform(ctm);

      const current = parseTranslate(block.getAttribute('transform'));

      dragState = {
        block,
        pointerId: e.pointerId,
        startX: startSVG.x,
        startY: startSVG.y,
        baseTx: current.x,
        baseTy: current.y,
        svg,
        ctm
      };

      block.classList.add('rtl-dragging');
      block.setPointerCapture(e.pointerId);
    }, true);  // ← capture phase

    /* -- pointermove -- */
    canvas.addEventListener('pointermove', e => {
      if (!dragState || dragState.pointerId !== e.pointerId) return;

      const pt = dragState.svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const cur = pt.matrixTransform(dragState.ctm);

      const tx = dragState.baseTx + (cur.x - dragState.startX);
      const ty = dragState.baseTy + (cur.y - dragState.startY);
      dragState.block.setAttribute('transform', translated(dragState.block.getAttribute('data-orig-transform') || '', tx, ty));
      refreshLeads(dragState.block);
    }, true);

    /* -- pointerup / pointercancel -- */
    function endDrag(e) {
      if (!dragState || dragState.pointerId !== e.pointerId) return;
      const block = dragState.block;
      block.classList.remove('rtl-dragging');
      if (block.hasPointerCapture(e.pointerId)) {
        block.releasePointerCapture(e.pointerId);
      }

      // Record the offset from the original layout position.
      const orig = parseTranslate(block.getAttribute('data-orig-transform'));
      const final = parseTranslate(block.getAttribute('transform'));
      const key = offsetKey(block);
      const dx = final.x - orig.x;
      const dy = final.y - orig.y;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        offsets.set(key, { dx, dy });
      } else {
        offsets.delete(key);
      }

      dragState = null;
    }
    canvas.addEventListener('pointerup', endDrag, true);
    canvas.addEventListener('pointercancel', endDrag, true);

    /* -- reset button -- */
    const resetBtn = document.getElementById('reset-blocks');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        offsets.clear();
        canvas.querySelectorAll('[data-draggable="true"]').forEach(block => {
          const orig = block.getAttribute('data-orig-transform') || '';
          block.setAttribute('transform', orig);
          refreshLeads(block);
        });
      });
    }

    /* Return a re-scan function so callers (e.g. the update handler) can
     * trigger marking after programmatic innerHTML replacement. */
    return { scanAndMark: scan, offsets };
  };
})();
