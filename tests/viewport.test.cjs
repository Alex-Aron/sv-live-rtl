const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(initial = {}) {
  let state = { expanded: ['top/one'], ...initial };
  const buttons = Object.fromEntries(['zoom-in', 'zoom-out', 'zoom-fit', 'zoom-reset', 'zoom-level'].map(id => [id, { events: {}, addEventListener(type, fn) { this.events[type] = fn; } }]));
  const canvas = {
    scrollLeft: 0, scrollTop: 0, clientWidth: 800, clientHeight: 600, events: {},
    classes: new Set(), captures: new Set(), focus() {},
    classList: { add(c) { canvas.classes.add(c); }, remove(c) { canvas.classes.delete(c); } },
    setAttribute() {}, getBoundingClientRect: () => ({ left: 10, top: 20 }),
    addEventListener(type, fn) { this.events[type] = fn; },
    setPointerCapture(id) { this.captures.add(id); }, hasPointerCapture(id) { return this.captures.has(id); }, releasePointerCapture(id) { this.captures.delete(id); }
  };
  const content = {
    style: {}, width: 1000, height: 800,
    getBoundingClientRect() {
      const zoom = Number(this.style.zoom) || 1;
      return { left: 26 - canvas.scrollLeft, top: 36 - canvas.scrollTop, width: this.width * zoom, height: this.height * zoom };
    }
  };
  const window = {};
  vm.runInNewContext(fs.readFileSync('resources/viewport.js', 'utf8'), { window, document: { getElementById: id => buttons[id] } });
  const viewport = window.rtlCreateViewport(canvas, { getState: () => state, setState: next => { state = next; } });
  const target = { closest: () => null };
  function fire(type, data = {}) {
    let prevented = false;
    canvas.events[type]({ target, preventDefault() { prevented = true; }, ...data });
    return prevented;
  }
  return { canvas, content, viewport, buttons, fire, state: () => state };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);

test('wheel/pinch zoom keeps the schematic point under the pointer fixed', () => {
  const h = harness(); h.viewport.setContent(h.content, { fit: true });
  const x = 350, y = 250;
  const before = h.content.getBoundingClientRect();
  const z1 = h.viewport.capture().zoom;
  const local = { x: (x - before.left) / z1, y: (y - before.top) / z1 };
  assert.equal(h.fire('wheel', { deltaY: -100, deltaMode: 0, clientX: x, clientY: y, ctrlKey: true }), true);
  const after = h.content.getBoundingClientRect(), z2 = h.viewport.capture().zoom;
  assert.ok(z2 > z1);
  close((x - after.left) / z2, local.x); close((y - after.top) / z2, local.y);
  assert.equal(h.viewport.capture().fit, false);
  assert.deepEqual(h.state().expanded, ['top/one']);
});

test('buttons and focused keyboard shortcuts zoom, fit, reset, and pan', () => {
  const h = harness(); h.viewport.setContent(h.content, { fit: true });
  h.buttons['zoom-in'].events.click();
  const zoom = h.viewport.capture().zoom;
  h.fire('keydown', { key: '+' }); assert.ok(h.viewport.capture().zoom > zoom);
  h.fire('keydown', { key: '0' }); assert.equal(h.viewport.capture().zoom, 1);
  assert.equal(h.buttons['zoom-level'].textContent, '100%');
  h.buttons['zoom-out'].events.click(); assert.ok(h.viewport.capture().zoom < 1);
  h.buttons['zoom-reset'].events.click(); assert.equal(h.viewport.capture().zoom, 1);
  const left = h.canvas.scrollLeft;
  h.fire('keydown', { key: 'ArrowRight' }); assert.equal(h.canvas.scrollLeft, left + 60);
  h.fire('keydown', { key: 'f' }); assert.equal(h.viewport.capture().fit, true);
  assert.equal(h.canvas.scrollLeft, 0);
  assert.equal(h.canvas.scrollTop, 0);
});

test('dragging pans without intercepting module expansion buttons', () => {
  const h = harness(); h.viewport.setContent(h.content, { fit: false });
  h.canvas.scrollLeft = 200; h.canvas.scrollTop = 150;
  h.fire('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  h.fire('pointermove', { pointerId: 1, clientX: 70, clientY: 50 });
  assert.equal(h.canvas.scrollLeft, 230); assert.equal(h.canvas.scrollTop, 200);
  assert.ok(h.canvas.classes.has('panning'));
  h.fire('pointerup', { pointerId: 1 }); assert.ok(!h.canvas.classes.has('panning'));
  const prevented = h.fire('pointerdown', { button: 0, pointerId: 2, target: { closest: () => ({ role: 'button' }) } });
  assert.equal(prevented, false); assert.equal(h.canvas.captures.size, 0);
});

test('manual view state survives replacement of the SVG and reload', () => {
  const h = harness(); h.viewport.setContent(h.content, { fit: false });
  h.buttons['zoom-in'].events.click(); h.canvas.scrollLeft = 160; h.canvas.scrollTop = 90;
  h.fire('scroll');
  const position = h.viewport.capture();
  const replacement = { ...h.content, style: {} };
  h.viewport.setContent(replacement, { position });
  close(Number(replacement.style.zoom), position.zoom);
  assert.equal(h.canvas.scrollLeft, 160); assert.equal(h.canvas.scrollTop, 90);
  const next = harness(h.state()); next.viewport.setContent(next.content);
  close(next.viewport.capture().zoom, position.zoom);
  assert.equal(next.canvas.scrollLeft, 160); assert.equal(next.canvas.scrollTop, 90);
});

test('zoom is clamped to 5–800 percent and form controls keep their keys', () => {
  const h = harness(); h.viewport.setContent(h.content, { fit: false });
  h.viewport.zoomBy(10000); assert.equal(h.viewport.capture().zoom, 8);
  h.viewport.zoomBy(0.000001); assert.equal(h.viewport.capture().zoom, 0.05);
  assert.equal(h.fire('keydown', { key: '+', target: { closest: () => ({ tagName: 'INPUT' }) } }), false);
  assert.equal(h.viewport.capture().zoom, 0.05);
});
