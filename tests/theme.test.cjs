const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const Module = require('node:module');
const vm = require('node:vm');

// The HTML generator only reads this VS Code setting; no extension host is needed.
let configuredTheme = 'auto';
let configuredPalette = {};
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  if (id === 'vscode') return {
    workspace: { getConfiguration: () => ({ get: (key) => key === 'customColors' ? configuredPalette : configuredTheme }) }
  };
  return originalLoad.call(this, id, ...args);
};
const { getWebviewHtml, getViewerTheme, getViewerPalette } = require('../out/webview');
Module._load = originalLoad;

test('theme setting defaults safely and initializes the webview', () => {
  for (const theme of ['auto', 'dark', 'light', 'custom', 'invalid']) {
    configuredTheme = theme;
    const expected = theme === 'invalid' ? 'auto' : theme;
    assert.equal(getViewerTheme(), expected);
    assert.ok(getWebviewHtml(getViewerTheme()).includes(`data-theme="${expected}"`));
  }
});

test('theme changes and failed synthesis preserve the last schematic', () => {
  const listeners = {};
  const sent = [];
  const makeCell = (type) => {
    const classes = new Set(['rtl-neutral']);
    return {
      classes,
      querySelector: () => ({ textContent: type }),
      classList: { remove: (c) => classes.delete(c), add: (c) => classes.add(c) }
    };
  };
  const cells = ['$dffe', '$sdffe', '$_DFFE_PP_', '$adlatch', '$pmux', '$alu', 'custom'].map(makeCell);
  const canvas = { innerHTML: '', querySelectorAll: () => cells };
  const badge = {};
  const select = { addEventListener: (event, fn) => { listeners[event] = fn; } };
  const styleValues = new Map();
  const style = { setProperty: (k, v) => styleValues.set(k, v), removeProperty: (k) => styleValues.delete(k) };
  const customPanel = {};
  const colorEvents = {};
  const colorInput = { dataset: { color: 'register-fill' }, value: '#123456', addEventListener: (e, fn) => { colorEvents[e] = fn; } };
  const document = {
    body: { dataset: { theme: 'auto' }, style },
    querySelectorAll: () => [colorInput],
    getElementById: (id) => ({ canvas, 'status-badge': badge, theme: select, 'custom-colors': customPanel })[id]
  };
  const script = getWebviewHtml('auto').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, {
    document,
    window: { addEventListener: (event, fn) => { listeners[event] = fn; } },
    acquireVsCodeApi: () => ({ postMessage: (msg) => sent.push(msg) })
  });
  const receive = (data) => listeners.message({ data });
  receive({ type: 'update', svg: '<svg>valid</svg>', warningCount: 0 });
  assert.equal(badge.textContent, 'Live (Lint Clean)');
  cells.slice(0, 4).forEach((cell) => assert.ok(cell.classes.has('rtl-register')));
  assert.ok(cells[4].classes.has('rtl-mux'));
  assert.ok(cells[5].classes.has('rtl-logic'));
  assert.ok(cells[6].classes.has('rtl-neutral'));
  for (const theme of ['light', 'dark', 'auto']) {
    receive({ type: 'theme', theme });
    assert.equal(document.body.dataset.theme, theme);
    assert.equal(select.value, theme);
    assert.equal(canvas.innerHTML, '<svg>valid</svg>');
  }
  select.value = 'light';
  listeners.change();
  assert.equal(sent[0].theme, 'light');
  assert.equal(document.body.dataset.theme, 'light');
  receive({ type: 'theme', theme: 'custom', customColors: { 'register-fill': '#654321' } });
  assert.equal(styleValues.get('--rtl-register-fill'), '#654321');
  assert.equal(customPanel.hidden, false);
  assert.equal(colorInput.value, '#654321');
  colorInput.value = '#112233';
  colorEvents.input();
  assert.equal(styleValues.get('--rtl-register-fill'), '#112233');
  colorEvents.change();
  assert.equal(sent[1].type, 'setCustomColors');
  assert.equal(sent[1].colors['register-fill'], '#112233');
  receive({ type: 'theme', theme: 'auto' });
  assert.equal(styleValues.size, 0);
  assert.equal(customPanel.hidden, true);
  assert.equal(canvas.innerHTML, '<svg>valid</svg>');
  receive({ type: 'status', state: 'synthesizing' });
  receive({ type: 'status', state: 'lint-failed', errorCount: 1 });
  assert.equal(canvas.innerHTML, '<svg>valid</svg>');
  assert.match(badge.textContent, /Showing Last Valid RTL/);
  receive({ type: 'status', state: 'lint-failed', errorMessage: 'Yosys failed' });
  assert.equal(canvas.innerHTML, '<svg>valid</svg>');
  assert.match(badge.textContent, /Yosys failed/);
});

test('the local skin preserves upstream symbols and scopes all its styles', () => {
  const original = readFileSync('resources/skins/default.svg', 'utf8');
  const custom = readFileSync('resources/skins/dark-digital.svg', 'utf8');
  const types = (skin) => [...skin.matchAll(/s:type="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(types(custom).filter(type => !type.startsWith('binary-mux') && !type.startsWith('memory-')), types(original));
  assert.equal(types(custom).filter(type => type.startsWith('binary-mux')).length, 8);
  for (const category of ['register', 'mux', 'logic', 'port']) {
    assert.ok(custom.includes(`class="rtl-${category}"`));
  }
  assert.match(custom, /circle\[class\^="net_"\].*!important/);
});

const { sanitizePalette } = require('../out/palette');
test('custom palette rejects CSS and HTML injection and supplies missing defaults', () => {
  const palette = sanitizePalette({ wire: '#ABC123', bus: '</script>', text: 'red; color: blue', unknown: '#ffffff' });
  assert.equal(palette.wire, '#ABC123');
  assert.equal(palette.bus, '#79c0ff');
  assert.equal(palette.text, '#d4d4d4');
  assert.equal(palette.unknown, undefined);
  const html = getWebviewHtml('custom', { background: '</script><script>bad</script>' });
  assert.ok(!html.includes('<script>bad'));
});

test('saved custom colors are restored when the viewer opens', () => {
  configuredTheme = 'custom';
  configuredPalette = { 'register-fill': '#123456', bus: '#fedcba' };
  const html = getWebviewHtml(getViewerTheme(), getViewerPalette());
  assert.ok(html.includes('data-theme="custom"'));
  assert.ok(html.includes('data-color="register-fill" value="#123456"'));
  assert.ok(html.includes('data-color="bus" value="#fedcba"'));
});

test('settings expose every supported custom palette key', () => {
  const { PALETTE_FIELDS } = require('../out/palette');
  const settings = JSON.parse(readFileSync('package.json', 'utf8')).contributes.configuration.properties;
  assert.ok(settings['sv-live-rtl.theme'].enum.includes('custom'));
  assert.deepEqual(Object.keys(settings['sv-live-rtl.customColors'].properties), Object.keys(PALETTE_FIELDS));
});
