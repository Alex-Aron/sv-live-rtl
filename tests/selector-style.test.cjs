const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { postProcessSvgBuses } = require('../out/netlistTransform');
const { RtlPipeline } = require('../out/pipeline');

function textOf(svg) {
  return [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
}

test('only split/join display ranges become high:low, without changing port keys or wiring', () => {
  const svg = `<svg><style></style>
    <text>0:7</text>
    <g s:type="generic"><text>1:7</text></g>
    <g s:type="split"><g s:pid="out0"/><g><text>1:7</text></g><g><text>9:2</text></g><g><text>0</text></g></g>
    <g s:type="join"><g s:pid="0:6"><text>0:6</text></g></g>
    <text>data [0:7]</text>
    <line x1="0" y1="10" x2="20" y2="10" class="net_2"/>
  </svg>`;
  const result = postProcessSvgBuses(svg);
  assert.deepEqual(textOf(result), ['0:7', '1:7', '7:1', '9:2', '0', '6:0', 'data [0:7]']);
  assert.ok(result.includes('s:pid="0:6"'));
  assert.ok(result.includes('class="net_2 width_1"'));
});

test('selector bodies and labels use the I/O accent while wire colors stay separate', async () => {
  const skin = await fs.readFile('resources/skins/dark-digital.svg', 'utf8');
  const webview = await fs.readFile('src/webview.ts', 'utf8');
  for (const type of ['split', 'join']) {
    assert.ok(skin.includes(`class="rtl-port rtl-selector" s:type="${type}"`));
  }
  assert.match(skin, /\.splitjoinBody\s*\{\s*fill: var\(--rtl-port-stroke, #bc8cff\);\s*stroke: var\(--rtl-port-stroke, #bc8cff\)/);
  assert.match(skin, /\.rtl-selector text\s*\{ fill: var\(--rtl-port-stroke, #bc8cff\)/);
  assert.ok(webview.includes('--rtl-wire: #d4d4d4;'));
  assert.ok(webview.includes('--rtl-bus: #79c0ff;'));
});

test('real slice/concat schematic has purple selectors, descending ranges and single-bit not output', async () => {
  const pipeline = new RtlPipeline();
  try {
    const result = await pipeline.run(`
module slice_colors(input [7:0] a, output [6:0] high, output [7:0] shifted, output zero);
  assign high = a[7:1];
  assign shifted = {a[6:0], 1'b0};
  assign zero = ~|a;
endmodule
`, path.resolve('resources/skins/dark-digital.svg'));
    assert.ok(result.svg, result.errorMessage);
    assert.ok(result.svg.includes('s:type="split"'));
    assert.ok(result.svg.includes('s:type="join"'));
    const labels = textOf(result.svg);
    assert.ok(labels.includes('7:1'));
    assert.ok(labels.includes('6:0'));
    assert.ok(!labels.includes('1:7'));
    assert.ok(!labels.includes('0:6'));
    assert.ok(result.svg.includes('s:type="not"'));
    assert.ok(result.svg.includes('width_1'));
    assert.ok(result.svg.includes('width_7 bus'));
  } finally { await pipeline.dispose(); }
});
