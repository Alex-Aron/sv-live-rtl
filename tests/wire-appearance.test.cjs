const { test } = require('node:test');
const assert = require('node:assert/strict');
const { postProcessSvgWires } = require('../out/svgWires');
const { withWireSpacing, normalizeWireSpacing } = require('../out/layoutSettings');
const wrap = s => `<svg class="rtl-schematic"><style></style>${s}</svg>`;
const line = (x1,y1,x2,y2,net='net_2') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${net} width_1"/>`;

test('unconnected crossings get a raised arc, connected nets remain joined', () => {
  const out = postProcessSvgWires(wrap(line(0,50,100,50)+line(50,0,50,100,'net_3')));
  assert.match(out, /class="net_2 width_1 wire-jump"/);
  assert.match(out, /A4,4 0 0 1 54,50/);
  assert.match(out, /wire-jump-clearance/);
  assert.doesNotMatch(postProcessSvgWires(wrap(line(0,50,100,50)+line(50,0,50,100))), /class="[^"]* wire-jump"/);
});

test('connected dots are larger and black with a contrasting outline', () => {
  const out = postProcessSvgWires(wrap(line(0,50,100,50)+`<circle cx="50" cy="50" r="2" class="net_2" style="fill:#000"/>`));
  assert.match(out, /r="3.5" class="net_2 wire-junction"/);
  assert.match(out, /circle.wire-junction \{ fill:#000 !important/);
});

test('wire through translated output label detours around text and preserves terminals', () => {
  const out = postProcessSvgWires(wrap(line(50,0,50,150)+`<g transform="translate(50,60)"><text x="0" y="0" class="nodelabel">pc_debug [31:0]</text></g>`));
  const lines = [...out.matchAll(/<line ([^>]+)>/g)].map(m=>Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(a=>[a[1],a[2]])));
  assert.equal(lines.length,5);
  assert.equal(lines[0].y1,'0'); assert.equal(lines.at(-1).y2,'150');
  assert.ok(lines.some(l=>l.x1===l.x2 && l.x1!=='50'));
});

test('branch junctions inside label detour bounds stay attached', () => {
  const out = postProcessSvgWires(wrap(line(50,0,50,150)+line(50,60,120,60)+`<circle cx="50" cy="60" r="2" class="net_2"/><text x="20" y="65">label</text>`));
  assert.match(out, /x1="50" y1="0" x2="50" y2="60"/);
  assert.match(out, /x1="50" y1="60" x2="50" y2="150"/);
});

test('wire spacing replaces ELK options rather than duplicating them', () => {
  const skin = '<s:layoutEngine org.eclipse.elk.spacing.edgeEdge="4" />';
  const out = withWireSpacing(withWireSpacing(skin,16),24);
  assert.equal((out.match(/org.eclipse.elk.spacing.edgeEdge=/g)||[]).length,1);
  assert.match(out,/edgeEdge="24"/);
  assert.match(out,/edgeNode="28"/);
  assert.equal(normalizeWireSpacing(NaN),16); assert.equal(normalizeWireSpacing(0),6);
});

test('crowded junction labels retain wiring and get foreground canvas clearance', () => {
  const out = postProcessSvgWires(wrap(line(50,0,50,150)+line(50,60,120,60)+`<circle cx="50" cy="60" r="2" class="net_2"/><g transform="translate(50,60)"><text x="0" y="5" id="label" class="nodelabel">pc_debug</text></g>`));
  assert.match(out, /<text x="50" y="65" class="nodelabel wire-label-clearance">pc_debug<\/text>/);
  assert.equal((out.match(/id="label"/g)||[]).length,1);
});

test('crossing shoulders cover the wide clearance at both bus joins', () => {
  const out = postProcessSvgWires(wrap(line(0,50,100,50,'net_2,4 width_2 bus')+line(50,0,50,100,'net_3')));
  const clearance = out.match(/<path d="M([\d.]+),50 A[^\"]+ ([\d.]+),50" class="wire-jump-clearance"[^>]+stroke-width:([\d.]+)/);
  const foreground = out.match(/<path class="[^"]+ wire-jump" d="M([\d.]+),50 L[^\"]+ L([\d.]+),50"/);
  assert.ok(clearance && foreground);
  assert.ok(+foreground[1] <= +clearance[1] - +clearance[3]/2, 'left join must be repainted across the clearance width');
  assert.ok(+foreground[2] >= +clearance[2] + +clearance[3]/2, 'right join must be repainted across the clearance width');
});

test('neighboring crossing clearances paint before all foreground jumps', () => {
  const out = postProcessSvgWires(wrap(line(0,50,100,50)+line(40,0,40,100,'net_3')+line(52,0,52,100,'net_4')));
  const masks = [...out.matchAll(/class="wire-jump-clearance"/g)].map(m=>m.index);
  const painted = [...out.matchAll(/class="net_2 width_1 wire-jump"/g)].map(m=>m.index);
  assert.equal(painted.length,2);
  assert.ok(Math.max(...masks)<Math.min(...painted), 'a later clearance must not erase an earlier jump');
});

test('close crossing shoulders never draw a flat chord through another jump', () => {
  const out = postProcessSvgWires(wrap(line(0,50,100,50)+line(40,0,40,100,'net_3')+line(46,0,46,100,'net_4')));
  const paths = [...out.matchAll(/<path class="net_2 width_1 wire-jump" d="M([\d.]+),50 L([\d.]+),50 A[\d.,]+ 0 0 1 ([\d.]+),50 L([\d.]+),50"/g)];
  assert.equal(paths.length,2);
  const a=paths[0].slice(1).map(Number), b=paths[1].slice(1).map(Number);
  assert.ok(a[3]<=b[1], 'first shoulder must stop before the second arc gap');
  assert.ok(b[0]>=a[2], 'second shoulder must start after the first arc gap');
});

test('foreground selector labels retain their purple category when copied', () => {
  const out = postProcessSvgWires(wrap(line(50,0,50,150)+line(50,60,120,60)+`<g class="rtl-port rtl-selector" transform="translate(50,60)"><text x="0" y="5" class="inputPortLabel">31:0</text></g>`));
  assert.match(out, /<g class="wire-labels"><g class="rtl-selector"><text[^>]*wire-label-clearance/);
});
