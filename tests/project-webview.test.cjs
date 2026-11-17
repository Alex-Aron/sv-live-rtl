const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

// Minimal SVG/HTML DOM for the viewer's mount/patch behavior. Layout comes from
// real netlistsvg integration tests; these checks exercise the browser script.
class Element {
  constructor(tag) {
    this.tagName = tag; this.map = new Map(); this.children = []; this.events = {};
    this.style = {}; this.hidden = false; this._text = '';
    this.dataset = new Proxy({}, {
      get: (_, key) => this.getAttribute('data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase())),
      set: (_, key, value) => { this.setAttribute('data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase()), value); return true; }
    });
  }
  get attributes() { return [...this.map].map(([name, value]) => ({ name, value })); }
  setAttribute(k, v) { this.map.set(k, String(v)); }
  getAttribute(k) { return this.map.get(k) ?? null; }
  set id(v) { this.setAttribute('id', v); } get id() { return this.getAttribute('id'); }
  set textContent(v) { this._text = v; this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...children); }
  addEventListener(type, fn) { this.events[type] = fn; }
  fire(type, extra = {}) { this.events[type]?.({ stopPropagation() {}, preventDefault() {}, ...extra }); }
  querySelectorAll(selector) {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    return all.filter(el => selector === '*' || selector === '[id]' && el.id ||
      selector.startsWith('.') && (el.getAttribute('class') || '').split(' ').includes(selector.slice(1)) || el.tagName === selector);
  }
  querySelector(s) { return this.querySelectorAll(s)[0]; }
  clone() { const el = new Element(this.tagName); for (const [k, v] of this.map) el.setAttribute(k, v); el._text = this._text; el.append(...this.children.map(c => c.clone())); return el; }
}
class Parser {
  parseFromString(source) {
    const wrapper = new Element('doc'), stack = [wrapper];
    for (const m of source.matchAll(/<[^>]+>|[^<]+/g)) {
      const token = m[0];
      if (token.startsWith('</')) stack.pop();
      else if (token.startsWith('<')) {
        const el = new Element(token.match(/^<([^\s/>]+)/)[1]);
        for (const attr of token.matchAll(/([\w:-]+)="([^"]*)"/g)) el.setAttribute(attr[1], attr[2]);
        stack.at(-1).append(el);
        if (!token.endsWith('/>')) stack.push(el);
      } else stack.at(-1)._text += token;
    }
    return { documentElement: wrapper.children[0], querySelector: s => wrapper.querySelector(s) };
  }
}

function harness(saved = {}) {
  const doc = new Element('document');
  const ids = ['canvas', 'status-badge', 'project-module', 'project-error', 'project-info', 'project-auto', 'project-refresh', 'project-reflow', 'zoom-in', 'zoom-out', 'zoom-fit', 'zoom-level'];
  const elements = Object.fromEntries(ids.map(id => { const el = new Element('div'); el.id = id; doc.append(el); return [id, el]; }));
  elements.canvas.clientWidth = 900; elements.canvas.clientHeight = 600;
  const sent = [], listeners = {};
  let state;
  const context = {
    document: { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), importNode: el => el.clone(), getElementById: id => doc.querySelectorAll('[id]').find(el => el.id === id) },
    viewport: undefined, DOMParser: Parser, canvas: elements.canvas, badge: elements['status-badge'], colorGenericCells() {},
    vscode: { getState: () => state || saved, setState: value => { state = value; }, postMessage: message => sent.push(message) },
    window: { addEventListener: (type, fn) => { listeners[type] = fn; } }
  };
  vm.runInNewContext(fs.readFileSync('resources/project-viewer.js', 'utf8'), context);
  return { route: context.routeModuleBridges, crossings: context.decorateModuleBridgeCrossings, elements, doc, sent, state: () => state, receive: data => listeners.message({ data }) };
}
function model(key, svg, ports = []) { return { key, name: key, svg, ports, width: 500, height: 300, instances: [], blackbox: false }; }
const leaf = text => model('leaf', `<svg width="120" height="80" viewBox="0 0 120 80"><g id="cell_a" transform="translate(5,20)"><text>${text}</text></g><g id="cell_y" transform="translate(80,20)"/></svg>`, [
  { name: 'a', label: 'a', direction: 'input', width: 1, y: 100 },
  { name: 'y', label: 'y', direction: 'output', width: 1, y: 100 }
]);
const top = model('top', `<svg width="1200" height="400" viewBox="0 0 1200 400"><g id="cell_one" class="rtl-module-instance" data-module="leaf" s:width="500" s:height="300" transform="translate(20,30)"/><g id="cell_two" class="rtl-module-instance" data-module="leaf" s:width="500" s:height="300" transform="translate(620,30)"/></svg>`);
const snapshot = modules => ({ type: 'projectSnapshot', top: 'top', modules, keys: ['top', 'leaf'], stats: { synthesized: [], rendered: [], reused: 2 } });

test('project UI expands instances independently, namespaces IDs, and patches only edited leaf contents', () => {
  const h = harness();
  assert.equal(h.sent[0].type, 'projectReady');
  h.receive(snapshot([top, leaf('XOR')]));
  assert.equal(h.elements['project-error'].textContent, '');
  let rootSvg = h.doc.querySelector('svg');
  let frames = rootSvg.querySelectorAll('.rtl-module-instance');
  assert.equal(frames.length, 2);
  frames[0].querySelector('.project-toggle').fire('click');
  assert.equal(h.sent.at(-1).type, 'projectLayout');
  h.receive(snapshot([top, leaf('XOR')])); // layout-only backend response
  rootSvg = h.doc.querySelector('svg'); frames = rootSvg.querySelectorAll('.rtl-module-instance');
  assert.equal(frames[0].querySelector('.project-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(frames[1].querySelector('.project-toggle').getAttribute('aria-expanded'), 'false');
  frames[1].querySelector('.project-toggle').fire('keydown', { key: 'Enter' });
  h.receive(snapshot([top, leaf('XOR')]));
  rootSvg = h.doc.querySelector('svg'); frames = rootSvg.querySelectorAll('.rtl-module-instance');
  const firstInner = frames[0].querySelector('svg');
  const secondInner = frames[1].querySelector('svg');
  const ids = h.doc.querySelectorAll('[id]').map(el => el.id);
  assert.equal(new Set(ids).size, ids.length);
  h.receive(snapshot([leaf('AND')]));
  assert.equal(h.doc.querySelector('svg'), rootSvg);
  assert.equal(rootSvg.querySelectorAll('.rtl-module-instance')[0], frames[0]);
  assert.notEqual(frames[0].querySelector('svg'), firstInner);
  assert.notEqual(frames[1].querySelector('svg'), secondInner);
  assert.ok(frames[0].querySelector('svg').textContent.includes('AND'));
  assert.equal(frames[0].querySelector('.project-toggle').getAttribute('aria-expanded'), 'true');
  h.receive({ type: 'projectStatus', error: 'Syntax error' });
  assert.equal(h.doc.querySelector('svg'), rootSvg);
  assert.equal(h.elements['project-error'].textContent, 'Syntax error');
  h.receive(snapshot([]));
  assert.equal(h.doc.querySelector('svg'), rootSvg);
  assert.equal(h.elements['project-error'].textContent, '');
  assert.equal(h.state().expanded.length, 2);
});

test('project controls request refresh/reflow, retain save preference and change module view', () => {
  const h = harness({ auto: true });
  assert.equal(h.sent[0].auto, true);
  h.elements['project-refresh'].fire('click');
  assert.equal(h.sent.at(-1).type, 'projectRefresh');
  h.elements['project-reflow'].fire('click');
  assert.equal(h.sent.at(-1).reflow, true);
  h.receive(snapshot([top, leaf('XOR')]));
  h.elements['project-module'].value = 'leaf';
  h.elements['project-module'].fire('change');
  assert.equal(h.sent.at(-1).type, 'projectLayout');
  h.receive({ ...snapshot([]), viewRoot: 'leaf', selected: 'leaf' });
  assert.equal(h.state().selected, 'leaf');
  assert.ok(h.doc.querySelector('svg').textContent.includes('XOR'));
  h.elements['project-auto'].checked = false;
  h.elements['project-auto'].fire('change');
  assert.equal(h.sent.at(-1).type, 'projectAuto');
  assert.equal(h.sent.at(-1).enabled, false);
});

function segments(points) {
  return points.slice(1).map((b, i) => ({ a: points[i], b }));
}
function assertNoSharedRuns(routes) {
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    for (const s of segments(routes[i].points)) for (const t of segments(routes[j].points)) {
      const sh = Math.abs(s.a[1] - s.b[1]) < 0.001;
      const th = Math.abs(t.a[1] - t.b[1]) < 0.001;
      if (sh !== th) continue; // ordinary perpendicular crossings are not shared runs
      const axis = sh ? 0 : 1, fixed = sh ? 1 : 0;
      const overlap = Math.min(Math.max(s.a[axis], s.b[axis]), Math.max(t.a[axis], t.b[axis])) -
        Math.max(Math.min(s.a[axis], s.b[axis]), Math.min(t.a[axis], t.b[axis]));
      assert.ok(!(overlap > 0.01 && Math.abs(s.a[fixed] - t.a[fixed]) < 3),
        `${routes[i].name} and ${routes[j].name} share a run: ${JSON.stringify(s)} / ${JSON.stringify(t)}`);
    }
  }
}

test('clock, reset and data bridges have separate lanes, including near-aligned entry/exit rows', () => {
  const { route } = harness();
  const connections = [
    { name: 'clk', width: 1, input: true, fromY: 120.5, x: 254, y: 272 },
    { name: 'rst', width: 1, input: true, fromY: 181, x: 132, y: 242 },
    { name: 'd', width: 8, input: true, fromY: 241.5, x: 132, y: 92 }
  ];
  const routed = route(connections, 662, 332, 120);
  assertNoSharedRuns(routed);
  for (const wire of routed) {
    assert.equal(wire.points[0][0], 0);
    assert.equal(wire.points[0][1], wire.fromY);
    assert.equal(wire.points.at(-1)[0], wire.x);
    assert.equal(wire.points.at(-1)[1], wire.y);
  }
  const outputs = connections.map(c => ({ ...c, input: false, x: 662 - c.x }));
  assertNoSharedRuns(route(outputs, 662, 332, 120));
});

test('collapsed module ports do not share the old common elbow', () => {
  const h = harness();
  const ports = ['clk', 'rst', 'data'].map((name, i) => ({ name, label: name, direction: 'input', width: i === 2 ? 8 : 1, y: 80 + i * 70 }));
  const child = model('leaf', leaf('XOR').svg, ports);
  h.receive(snapshot([top, child]));
  const frame = h.doc.querySelector('.rtl-module-instance');
  const paths = frame.querySelectorAll('.project-bridge');
  const routes = paths.map(p => ({ name: p.getAttribute('data-port'), points: [...p.getAttribute('d').matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map(m => [+m[1], +m[2]]) }));
  assert.equal(routes.length, 3);
  assertNoSharedRuns(routes);
  assert.equal(paths.find(p => p.getAttribute('data-port') === 'data').getAttribute('class'), 'project-bridge bus');
  assert.equal(paths.find(p => p.getAttribute('data-port') === 'clk').getAttribute('class'), 'project-bridge');
});

test('many-port interfaces reserve distinct lanes with bus-stroke clearance', () => {
  const { route } = harness();
  const count = 32, gutter = 56 + (2 * count + 1) * 8;
  const connections = Array.from({ length: count }, (_, i) => ({
    name: 'p' + i, width: 8, input: true, fromY: 90 + i * 28, x: gutter + 30, y: 90 + (count - i - 1) * 28
  }));
  const routes = route(connections, gutter * 2 + 400, count * 28 + 200, gutter);
  assertNoSharedRuns(routes);
  assert.ok(routes.every(r => r.points.flat().every(Number.isFinite)));
});

test('expanded bridges from real project layouts keep clock/reset and data runs separate', async () => {
  const path = require('node:path');
  const files = require('node:fs/promises');
  const { ProjectPipeline } = require('../out/projectPipeline');
  const pipeline = new ProjectPipeline();
  try {
    const dir = path.resolve('examples/project');
    const sources = await Promise.all((await files.readdir(dir)).filter(n => /\.svh?$/.test(n)).map(async n => ({ path: path.join(dir, n), content: await files.readFile(path.join(dir, n), 'utf8') })));
    const result = await pipeline.runProject(sources, 'project_demo', path.resolve('resources/skins/dark-digital.svg'));
    assert.ok(result.ok, result.error);
    const { route } = harness();
    for (const model of result.modules) {
      const vb = model.svg.match(/viewBox="([^"]+)"/)[1].split(/[ ,]+/).map(Number);
      const innerW = model.width - 2 * model.gutter, innerH = model.height - 90;
      const scale = Math.min(innerW / vb[2], innerH / vb[3]);
      const dx = model.gutter + (innerW - vb[2] * scale) / 2 - vb[0] * scale;
      const dy = 60 + (innerH - vb[3] * scale) / 2 - vb[1] * scale;
      const connections = model.ports.map(port => {
        const cell = [...model.svg.matchAll(/<g\b[^>]*>/g)].find(m => m[0].includes(`id="cell_${port.label}"`))[0];
        const t = cell.match(/translate\(([^,]+),([^)]*)\)/);
        return { name: port.name, width: port.width, input: port.direction === 'input', fromY: port.y,
          x: dx + (+t[1] + (port.direction === 'input' ? 0 : 30)) * scale, y: dy + (+t[2] + (port.direction === 'input' ? 10 : 30)) * scale };
      });
      assertNoSharedRuns(route(connections, model.width, model.height, model.gutter));
    }
  } finally { await pipeline.dispose(); }
});

test('aligned ports are straight and ordinary offsets need only two bends', () => {
  const { route } = harness();
  const direct = route([{ name: 'a', input: true, width: 8, fromY: 80, x: 120, y: 80 }], 400, 200, 64)[0];
  assert.equal(direct.points.length, 2);
  const bent = route([{ name: 'a', input: true, width: 8, fromY: 80, x: 120, y: 130 }], 400, 200, 64)[0];
  assert.equal(bent.points.length, 4);
  const length = segments(bent.points).reduce((sum, s) => sum + Math.abs(s.a[0] - s.b[0]) + Math.abs(s.a[1] - s.b[1]), 0);
  assert.equal(length, 170); // shortest possible orthogonal route
});

test('instance-specific layout scenes expand one instance while keeping its sibling compact', () => {
  const h = harness({ expanded: ['top/one'] });
  const sceneLeaf = { ...leaf('XOR'), key: '@view-leaf', baseKey: 'leaf' };
  const sceneTop = { ...top, key: '@view-top', baseKey: 'top', svg: top.svg.replace('data-module="leaf"', 'data-module="@view-leaf"') };
  h.receive({ ...snapshot([top, leaf('XOR'), sceneTop, sceneLeaf]),
    sceneKeys: ['top', 'leaf', '@view-top', '@view-leaf'], viewRoot: '@view-top', selected: 'top' });
  assert.equal(h.elements['project-error'].textContent, '');
  assert.equal(h.elements['project-module'].value, 'top');
  const frames = h.doc.querySelectorAll('.rtl-module-instance');
  assert.equal(frames[0].querySelector('.project-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(frames[1].querySelector('.project-toggle').getAttribute('aria-expanded'), 'false');
  frames[0].querySelector('.project-toggle').fire('click');
  assert.equal(h.sent.at(-1).type, 'projectLayout');
  assert.equal(h.sent.at(-1).selected, 'top');
  assert.equal(h.sent.at(-1).expanded.length, 0);
  h.receive({ ...snapshot([{ ...sceneTop, svg: top.svg }]), sceneKeys: ['top', 'leaf', '@view-top'], viewRoot: '@view-top', selected: 'top' });
  assert.equal(h.elements['project-error'].textContent, '');
  for (const frame of h.doc.querySelectorAll('.rtl-module-instance')) assert.equal(frame.querySelector('.project-toggle').getAttribute('aria-expanded'), 'false');
});

test('boundary lane pitch is adjustable and expanded labels have a clear column', () => {
  const { route } = harness();
  const labelClearance = 140;
  const connections = Array.from({ length: 4 }, (_, i) => ({
    name: 'input_' + i, input: true, width: 8, fromY: 100 + i * 30, x: 400, y: 270 + i * 30
  }));
  for (const spacing of [16, 24]) {
    const gutter = labelClearance + 48 + (connections.length + 1) * spacing;
    const routed = route(connections, 900, 500, gutter, spacing, labelClearance);
    assertNoSharedRuns(routed);
    const lanes = routed.map(r => r.points[1][0]).sort((a, b) => a - b);
    for (let i = 1; i < lanes.length; i++) assert.equal(lanes[i] - lanes[i - 1], spacing);
    assert.ok(lanes.every(x => x > labelClearance + 16));
    for (const r of routed) assert.equal(r.points.length, 4);
  }
});

test('unconnected bridge crossings use raised arcs with gaps and retain route geometry', () => {
  const { crossings } = harness();
  const horizontal = { name: 'data', width: 8, points: [[0, 50], [120, 50]], d: 'M0,50 L120,50' };
  const vertical = { name: 'clk', width: 1, points: [[60, 0], [60, 100]], d: 'M60,0 L60,100' };
  const decorated = crossings([horizontal, vertical]);
  assert.equal(decorated.jumps.length, 1);
  assert.equal(decorated.jumps[0].clearanceD, 'M56,50 A4,4 0 0 1 64,50');
  assert.equal(decorated.jumps[0].d, 'M52,50 L56,50 A4,4 0 0 1 64,50 L68,50');
  assert.equal(decorated.routes[0].d, 'M0,50 L56,50 M64,50 L120,50');
  assert.equal(decorated.routes[0].points, horizontal.points);
  assert.equal(decorated.routes[1].points, vertical.points);
  assert.equal(crossings([horizontal, { ...vertical, points: [[60, 50], [60, 100]] }]).jumps.length, 0);
  assert.equal(crossings([horizontal, { ...vertical, points: [[3, 0], [3, 100]] }]).jumps.length, 0);
  assert.equal(crossings([horizontal, vertical, { name: 'junction', points: [[60, 50], [90, 90]] }]).jumps.length, 0);
});

test('dense bridge crossing shoulders stay out of neighboring arc interiors', () => {
  const { crossings } = harness();
  const routes = [{ name: 'data', width: 8, points: [[0, 50], [120, 50]] },
    ...[40, 46].map((x, i) => ({ name: 'p' + i, width: 1, points: [[x, 0], [x, 100]] }))];
  const { jumps } = crossings(routes);
  assert.equal(jumps.length, 2);
  assert.match(jumps[0].d, /A2.5,2.5 0 0 1 42.5,50 L43.5,50$/);
  assert.match(jumps[1].d, /^M42.5,50 L43.5,50 A2.5,2.5/);
});

test('expanded output bridges read their shifted glyph pin offset', () => {
  const h = harness({ expanded: ['top/one'] });
  const child = leaf('XOR');
  child.svg = child.svg.replace('<g id="cell_y" transform="translate(80,20)"/>', '<g id="cell_y" transform="translate(80,20)"><g s:x="0" s:y="30" s:pid="A"/></g>');
  h.receive(snapshot([top, child]));
  const frame = h.doc.querySelector('.rtl-module-instance');
  const wire = frame.querySelectorAll('.project-bridge').find(el => el.getAttribute('data-port') === 'y');
  const scale = Math.min(260 / 120, 210 / 80);
  const expectedY = 60 + (210 - 80 * scale) / 2 + (20 + 30) * scale;
  const points = [...wire.getAttribute('d').matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map(m => [+m[1], +m[2]]);
  assert.ok(points.some(([, y]) => Math.abs(y - expectedY) < 0.01));
});
