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
  vm.runInNewContext(fs.readFileSync('resources/project-viewer.js', 'utf8'), {
    document: { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), importNode: el => el.clone(), getElementById: id => doc.querySelectorAll('[id]').find(el => el.id === id) },
    viewport: undefined, DOMParser: Parser, canvas: elements.canvas, badge: elements['status-badge'], colorGenericCells() {},
    vscode: { getState: () => state || saved, setState: value => { state = value; }, postMessage: message => sent.push(message) },
    window: { addEventListener: (type, fn) => { listeners[type] = fn; } }
  });
  return { elements, doc, sent, state: () => state, receive: data => listeners.message({ data }) };
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
  const rootSvg = h.doc.querySelector('svg');
  const frames = rootSvg.querySelectorAll('.rtl-module-instance');
  assert.equal(frames.length, 2);
  frames[0].querySelector('.project-toggle').fire('click');
  assert.equal(frames[0].querySelector('.project-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(frames[1].querySelector('.project-toggle').getAttribute('aria-expanded'), 'false');
  frames[1].querySelector('.project-toggle').fire('keydown', { key: 'Enter' });
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
  assert.equal(h.state().selected, 'leaf');
  assert.ok(h.doc.querySelector('svg').textContent.includes('XOR'));
  h.elements['project-auto'].checked = false;
  h.elements['project-auto'].fire('change');
  assert.equal(h.sent.at(-1).type, 'projectAuto');
  assert.equal(h.sent.at(-1).enabled, false);
});
