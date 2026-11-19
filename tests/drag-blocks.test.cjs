const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

// ---- Minimal SVG/HTML DOM simulator for drag-blocks tests ----

class ClassList {
  constructor() { this._set = new Set(); }
  add(c) { this._set.add(c); }
  remove(c) { this._set.delete(c); }
  contains(c) { return this._set.has(c); }
  toggle(c, force) { if (force) this.add(c); else this.remove(c); }
}

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.nodeType = 1;
    this._attrs = new Map();
    this.children = [];
    this.parentNode = null;
    this.events = {};
    this.classList = new ClassList();
    this.style = {};
    this._text = '';
    this._captures = new Set();
    this.dataset = new Proxy({}, {
      get: (_, key) => this.getAttribute('data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase())),
      set: (_, key, value) => { this.setAttribute('data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase()), String(value)); return true; }
    });
  }
  get id() { return this.getAttribute('id'); }
  set id(v) { this.setAttribute('id', v); }
  get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); }
  setAttribute(k, v) { this._attrs.set(k, String(v)); }
  getAttribute(k) { return this._attrs.get(k) ?? null; }
  hasAttribute(k) { return this._attrs.has(k); }
  append(...children) { for (const c of children) { c.parentNode = this; this.children.push(c); } }
  replaceChildren(...children) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...children); }
  closest(selector) {
    let el = this;
    while (el) {
      if (selector === 'svg' && (el.tagName === 'svg' || el.tagName === 'SVG')) return el;
      if (selector.startsWith('#') && el.id === selector.slice(1)) return el;
      if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) return el;
      el = el.parentNode;
    }
    return null;
  }
  addEventListener(type, fn, opts) {
    const key = type + (opts === true || opts?.capture ? ':capture' : '');
    if (!this.events[key]) this.events[key] = [];
    this.events[key].push(fn);
  }
  fire(type, data = {}, capture = false) {
    let stopped = false, prevented = false;
    const key = type + (capture ? ':capture' : '');
    const event = {
      ...data,
      target: data.target || this,
      stopPropagation() { stopped = true; },
      preventDefault() { prevented = true; }
    };
    for (const fn of (this.events[key] || [])) fn(event);
    return { stopped, prevented };
  }
  querySelectorAll(selector) {
    const all = this._descendants();
    if (selector === '*') return all;
    if (selector === 'g') return all.filter(el => el.tagName === 'g' || el.tagName === 'G');
    if (selector.startsWith('[')) {
      const m = selector.match(/\[([^\]=]+)(?:="([^"]*)")?\]/);
      if (m) return all.filter(el => m[2] !== undefined ? el.getAttribute(m[1]) === m[2] : el.hasAttribute(m[1]));
    }
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      return all.filter(el => el.classList.contains(cls) || (el.getAttribute('class') || '').split(' ').includes(cls));
    }
    return [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  _descendants() {
    const result = [];
    for (const child of this.children) { result.push(child); result.push(...child._descendants()); }
    return result;
  }
  setPointerCapture(id) { this._captures.add(id); }
  hasPointerCapture(id) { return this._captures.has(id); }
  releasePointerCapture(id) { this._captures.delete(id); }
  // For SVG-like elements
  createSVGPoint() {
    return {
      x: 0, y: 0,
      matrixTransform(m) {
        return { x: this.x * m.a + this.y * m.c + m.e, y: this.x * m.b + this.y * m.d + m.f };
      }
    };
  }
  getScreenCTM() {
    // Identity matrix for tests (no zoom)
    return {
      a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
      inverse() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
    };
  }
}

// Minimal MutationObserver polyfill for Node.js tests
class MockMutationObserver {
  constructor(callback) { this._callback = callback; }
  observe() {}
  disconnect() {}
}

function buildTestDom(dragEnabled = false) {
  // Build a canvas with an SVG containing draggable blocks
  const canvas = new Element('div');
  canvas.id = 'canvas';

  const svg = new Element('svg');
  svg.setAttribute('width', '800');
  svg.setAttribute('height', '600');
  canvas.append(svg);

  // A cell block (id=cell_dff0)
  const cellBlock = new Element('g');
  cellBlock.id = 'cell_dff0';
  cellBlock.setAttribute('transform', 'translate(100, 200)');
  svg.append(cellBlock);

  // A block with s:type (input port)
  const portBlock = new Element('g');
  portBlock.setAttribute('s:type', 'inputExt');
  portBlock.id = 'cell_clk';
  portBlock.setAttribute('transform', 'translate(50, 50)');
  svg.append(portBlock);

  // A non-draggable wire path
  const wire = new Element('path');
  wire.setAttribute('d', 'M0,0 L100,100');
  svg.append(wire);

  // A project-toggle button (should NOT be draggable)
  const toggleG = new Element('g');
  toggleG.classList.add('project-toggle');
  toggleG.setAttribute('role', 'button');
  const toggleRect = new Element('rect');
  toggleG.append(toggleRect);
  svg.append(toggleG);

  // Reset button
  const resetBtn = new Element('button');
  resetBtn.id = 'reset-blocks';
  const dragToggle = new Element('input');
  dragToggle.checked = dragEnabled;

  return { canvas, svg, cellBlock, portBlock, wire, toggleG, toggleRect, resetBtn, dragToggle };
}

function loadDragBlocks(portsOnly = false, dragEnabled = false) {
  const dom = buildTestDom(dragEnabled);
  const doc = {
    createElementNS: (_ns, tag) => new Element(tag),
    getElementById: id => {
      if (id === 'canvas') return dom.canvas;
      if (id === 'reset-blocks') return dom.resetBtn;
      if (id === 'toggle-block-drag') return dom.dragToggle;
      return null;
    }
  };
  const win = {};
  vm.runInNewContext(fs.readFileSync('resources/drag-blocks.js', 'utf8'), {
    window: win,
    document: doc,
    MutationObserver: MockMutationObserver
  });
  const dragBlocks = win.rtlInitDragBlocks(dom.canvas, portsOnly);
  return { ...dom, dragBlocks };
}

// ---- Tests ----

test('blocks with s:type or id=cell_... get data-draggable=true', () => {
  const { cellBlock, portBlock, wire, toggleG } = loadDragBlocks();
  assert.equal(cellBlock.getAttribute('data-draggable'), 'true');
  assert.equal(portBlock.getAttribute('data-draggable'), 'true');
  // wire is not a <g> and has no s:type or cell_ id → not draggable
  assert.equal(wire.getAttribute('data-draggable'), null);
  // project-toggle is a <g> but doesn't have s:type or cell_ id
  assert.equal(toggleG.getAttribute('data-draggable'), null);
});

test('data-orig-transform is recorded on initialization', () => {
  const { cellBlock, portBlock } = loadDragBlocks();
  assert.equal(cellBlock.getAttribute('data-orig-transform'), 'translate(100, 200)');
  assert.equal(portBlock.getAttribute('data-orig-transform'), 'translate(50, 50)');
});

test('dragging a block updates its transform via pointer events', () => {
  const { canvas, cellBlock } = loadDragBlocks(false, true);

  // Simulate pointerdown on the cell block
  const { stopped, prevented } = canvas.fire('pointerdown', {
    button: 0,
    pointerId: 1,
    clientX: 100,
    clientY: 200,
    target: cellBlock
  }, true);

  assert.ok(stopped, 'stopPropagation should be called');
  assert.ok(prevented, 'preventDefault should be called');
  assert.ok(cellBlock.classList.contains('rtl-dragging'), 'should have rtl-dragging class');

  // Simulate pointermove — move 50px right, 30px down
  canvas.fire('pointermove', {
    pointerId: 1,
    clientX: 150,
    clientY: 230,
    target: cellBlock
  }, true);

  // The block should have moved by (50, 30) from its base (100, 200) → (150, 230)
  const transform = cellBlock.getAttribute('transform');
  assert.match(transform, /translate\(150,\s*230\)/);

  // Simulate pointerup
  canvas.fire('pointerup', { pointerId: 1, target: cellBlock }, true);
  assert.ok(!cellBlock.classList.contains('rtl-dragging'), 'rtl-dragging should be removed');
});

test('clicking .project-toggle does NOT start a block drag', () => {
  const { canvas, toggleRect } = loadDragBlocks(false, true);

  // pointerdown on the toggle's inner rect — walks up to .project-toggle
  const { stopped } = canvas.fire('pointerdown', {
    button: 0,
    pointerId: 2,
    clientX: 10,
    clientY: 10,
    target: toggleRect
  }, true);

  // Should NOT intercept — findDraggable returns null for .project-toggle
  assert.ok(!stopped, 'stopPropagation should NOT be called for toggle clicks');
});

test('clicking #reset-blocks restores data-orig-transform and clears offsets', () => {
  const { canvas, cellBlock, resetBtn, dragBlocks } = loadDragBlocks(false, true);

  // Drag the block
  canvas.fire('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 200, target: cellBlock }, true);
  canvas.fire('pointermove', { pointerId: 1, clientX: 200, clientY: 300, target: cellBlock }, true);
  canvas.fire('pointerup', { pointerId: 1, target: cellBlock }, true);

  // Confirm it moved
  assert.notEqual(cellBlock.getAttribute('transform'), 'translate(100, 200)');
  assert.ok(dragBlocks.offsets.size > 0, 'offset map should have entries');

  // Click reset
  resetBtn.fire('click');

  // Should be back to original
  assert.equal(cellBlock.getAttribute('transform'), 'translate(100, 200)');
  assert.equal(dragBlocks.offsets.size, 0, 'offset map should be cleared');
});

test('right-click (button !== 0) does not start dragging', () => {
  const { canvas, cellBlock } = loadDragBlocks(false, true);

  const { stopped } = canvas.fire('pointerdown', {
    button: 2,
    pointerId: 3,
    clientX: 100,
    clientY: 200,
    target: cellBlock
  }, true);

  assert.ok(!stopped, 'right-click should not intercept');
});

test('dragging empty canvas background does not intercept (passes to viewport)', () => {
  const { canvas, wire } = loadDragBlocks(false, true);

  // pointerdown on a wire (not a draggable block)
  const { stopped } = canvas.fire('pointerdown', {
    button: 0,
    pointerId: 4,
    clientX: 50,
    clientY: 50,
    target: wire
  }, true);

  assert.ok(!stopped, 'wire clicks should pass through to viewport panning');
});

test('scanAndMark marks newly added blocks (simulating live re-synthesis)', () => {
  const { canvas, svg, dragBlocks } = loadDragBlocks();

  // Add a new cell block after initialization
  const newBlock = new Element('g');
  newBlock.id = 'cell_new_adder';
  newBlock.setAttribute('transform', 'translate(300, 400)');
  svg.append(newBlock);

  // Manually trigger scan (like the update handler does)
  dragBlocks.scanAndMark(canvas);

  assert.equal(newBlock.getAttribute('data-draggable'), 'true');
  assert.equal(newBlock.getAttribute('data-orig-transform'), 'translate(300, 400)');
});

test('saved offsets are reapplied after scanAndMark on re-synthesis', () => {
  const { canvas, dragBlocks } = loadDragBlocks();

  // Pre-populate the offset map (simulating a previous drag)
  dragBlocks.offsets.set('cell_restored', { dx: 25, dy: -10 });

  // Create a new SVG with a block that matches the saved key
  const svg2 = new Element('svg');
  const restoredBlock = new Element('g');
  restoredBlock.id = 'cell_restored';
  restoredBlock.setAttribute('transform', 'translate(100, 100)');
  svg2.append(restoredBlock);

  canvas.replaceChildren(svg2);
  dragBlocks.scanAndMark(canvas);

  // The block should have its offset reapplied: 100+25=125, 100-10=90
  assert.equal(restoredBlock.getAttribute('transform'), 'translate(125, 90)');
  assert.equal(restoredBlock.getAttribute('data-orig-transform'), 'translate(100, 100)');
});

test('project-viewer prefixed cell_ IDs are recognized as draggable', () => {
  const { canvas, dragBlocks } = loadDragBlocks();

  const projectBlock = new Element('g');
  projectBlock.id = 'project-5-cell_mux0';
  projectBlock.setAttribute('transform', 'translate(10, 20)');
  const svg = canvas.children[0];
  svg.append(projectBlock);

  dragBlocks.scanAndMark(canvas);

  assert.equal(projectBlock.getAttribute('data-draggable'), 'true');
});

test('MutationObserver callback marks dynamically added blocks via scanAndMark', () => {
  const { canvas, dragBlocks } = loadDragBlocks();

  const container = new Element('g');
  const innerBlock = new Element('g');
  innerBlock.setAttribute('s:type', '$add');
  innerBlock.id = 'cell_add0';
  innerBlock.setAttribute('transform', 'translate(0, 0)');
  container.append(innerBlock);

  // This simulates what the MutationObserver callback does
  dragBlocks.scanAndMark(container);

  assert.equal(innerBlock.getAttribute('data-draggable'), 'true');
});

test('webview HTML includes reset-blocks button and draggable styles', () => {
  const html = fs.readFileSync('out/webview.js', 'utf8');
  // Check via the compiled output that the HTML template includes our additions
  assert.ok(html.includes('reset-blocks'), 'HTML should include reset-blocks button');
  assert.ok(html.includes('data-draggable'), 'HTML should include draggable CSS rule');
  assert.ok(html.includes('rtl-dragging'), 'HTML should include rtl-dragging CSS rule');
  assert.ok(html.includes('Drag input/output/constant'), 'viewport hint should mention draggable symbols');
  assert.ok(html.includes('dragBlocksScriptUri'), 'function should accept dragBlocksScriptUri');
  assert.ok(html.includes('rtlInitDragBlocks'), 'inline script should call rtlInitDragBlocks');
  assert.ok(html.includes('Enable block dragging (experimental)'), 'label should include (experimental)');
  assert.ok(!html.includes('id="toggle-block-drag" checked'), 'toggle should not be checked by default');
});

test('a connected wire gains a lead to the moved pin and reset restores it', () => {
  const { canvas, svg, cellBlock, resetBtn, dragBlocks } = loadDragBlocks(false, true);
  const pin = new Element('g');
  pin.setAttribute('s:pid', 'A'); pin.setAttribute('s:x', '0'); pin.setAttribute('s:y', '0');
  cellBlock.append(pin);
  const line = new Element('line');
  line.setAttribute('class', 'net_2'); line.setAttribute('x1', '100'); line.setAttribute('y1', '200');
  line.setAttribute('x2', '80'); line.setAttribute('y2', '200'); svg.append(line);
  const point = () => ({ x: 0, y: 0, matrixTransform(m) { const p = point(); p.x = this.x + m.x; p.y = this.y + m.y; return p; } });
  const identity = { x: 0, y: 0, inverse() { return this; } };
  svg.createSVGPoint = point; svg.getScreenCTM = () => identity;
  line.getScreenCTM = () => identity;
  cellBlock.getScreenCTM = () => { const m = /translate\(([^,]+),\s*([^\)]+)\)/.exec(cellBlock.getAttribute('transform')); return { x: +m[1], y: +m[2] }; };
  cellBlock.querySelectorAll = selector => selector === '[s\\:pid]' ? [pin] : [];
  pin.closest = selector => selector === 'svg' ? svg : selector === '[data-draggable="true"]' ? cellBlock : null;
  const oldQuery = svg.querySelectorAll.bind(svg);
  svg.querySelectorAll = selector => selector === 'line[class*="net_"]' ? [line] : oldQuery(selector);
  svg.appendChild = child => svg.append(child);
  canvas.fire('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 200, target: cellBlock }, true);
  canvas.fire('pointermove', { pointerId: 1, clientX: 120, clientY: 230, target: cellBlock }, true);
  canvas.fire('pointerup', { pointerId: 1, target: cellBlock }, true);
  const lead = svg.children.find(el => el.tagName === 'path' && (el.getAttribute('class') || '').includes('rtl-drag-lead'));
  assert.equal(lead.getAttribute('d'), 'M100,200 L120,200 L120,230');
  resetBtn.fire('click');
  assert.equal(lead.getAttribute('d'), 'M100,200 L100,200 L100,200');
});


test('live viewer permits only input, output and constant symbols', () => {
  const { canvas, svg, cellBlock, portBlock, dragBlocks } = loadDragBlocks(true, true);
  const output = new Element('g'); output.setAttribute('s:type', 'outputExt'); output.id = 'cell_y';
  const constant = new Element('g'); constant.setAttribute('s:type', 'constant'); constant.id = 'cell_0';
  const gate = new Element('g'); gate.setAttribute('s:type', 'and'); gate.id = 'cell_gate';
  svg.append(output, constant, gate); dragBlocks.scanAndMark(canvas);
  assert.equal(portBlock.getAttribute('data-draggable'), 'true');
  assert.equal(output.getAttribute('data-draggable'), 'true');
  assert.equal(constant.getAttribute('data-draggable'), 'true');
  assert.equal(cellBlock.getAttribute('data-draggable'), null);
  assert.equal(gate.getAttribute('data-draggable'), null);
  assert.equal(canvas.fire('pointerdown', {button: 0, pointerId: 1, target: gate}, true).stopped, false);
});


test('drag toggle lets pointerdown pass through and restores dragging', () => {
  const { canvas, cellBlock, dragToggle } = loadDragBlocks();
  assert.equal(dragToggle.checked, false);
  assert.ok(canvas.classList.contains('block-drag-disabled'));
  assert.equal(canvas.fire('pointerdown', { button: 0, pointerId: 1, target: cellBlock }, true).stopped, false);
  assert.equal(cellBlock.getAttribute('transform'), 'translate(100, 200)');
  dragToggle.checked = true; dragToggle.fire('change');
  assert.ok(!canvas.classList.contains('block-drag-disabled'));
  assert.equal(canvas.fire('pointerdown', { button: 0, pointerId: 2, clientX: 100, clientY: 200, target: cellBlock }, true).stopped, true);
  canvas.fire('pointerup', { pointerId: 2 }, true);
  dragToggle.checked = false; dragToggle.fire('change');
  assert.ok(canvas.classList.contains('block-drag-disabled'));
  assert.equal(canvas.fire('pointerdown', { button: 0, pointerId: 3, target: cellBlock }, true).stopped, false);
});
