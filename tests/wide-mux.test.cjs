const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { transformYosysNetlist } = require('../out/netlistTransform');
const { RtlPipeline } = require('../out/pipeline');

for (const choices of [4, 8, 16, 32]) {
  for (const width of [1, 8]) {
    test(`${choices}:1 ${width}-bit mux keeps every word and binary selector in order`, () => {
      const A = Array.from({ length: choices * width }, (_, i) => i + 10);
      // Include constants and repeated nets to catch accidental filtering/deduplication.
      A[0] = '0'; A[A.length - 1] = 'x'; A[2] = A[1];
      const S = Array.from({ length: Math.log2(choices) }, (_, i) => i + 1000);
      const Y = Array.from({ length: width }, (_, i) => i + 2000);
      const cell = { type: '$bmux', connections: { A, S, Y }, parameters: { WIDTH: width.toString(2), S_WIDTH: Math.log2(choices).toString(2) } };
      const netlist = { modules: { top: { cells: { select: cell } } } };
      const parameters = structuredClone(cell.parameters);
      transformYosysNetlist(netlist);
      assert.equal(cell.type, `$binary_mux${choices}${width > 1 ? '-bus' : ''}`);
      assert.deepEqual(cell.parameters, parameters);
      assert.deepEqual(cell.connections.S, S);
      assert.deepEqual(cell.connections.Y, Y);
      for (let select = 0; select < choices; select++) {
        assert.deepEqual(cell.connections[`I${select}`], A.slice(select * width, (select + 1) * width));
        assert.equal(cell.port_directions[`I${select}`], 'input');
      }
      assert.equal(cell.port_directions.Y, 'output');
      assert.equal(Object.keys(cell.connections).length, choices + 2);
      assert.equal(cell.connections.A, undefined);
      const once = JSON.stringify(netlist);
      transformYosysNetlist(netlist);
      assert.equal(JSON.stringify(netlist), once);
    });
  }
}

test('2:1 binary muxes reuse the existing stacked 2:1 template', () => {
  const cell = { type: '$bmux', connections: { A: [2, 3, 4, 5], S: [6], Y: [7, 8] } };
  transformYosysNetlist({ modules: { top: { cells: { u: cell } } } });
  assert.equal(cell.type, '$mux-bus');
  assert.deepEqual(cell.connections, { A: [2, 3], B: [4, 5], S: [6], Y: [7, 8] });
});

test('unrecognized binary mux shapes remain intact', () => {
  for (const connections of [
    { A: [2, 3], S: [4, 5], Y: [6] },
    { A: [2], Y: [3] },
    { A: Array(64).fill(2), S: [3, 4, 5, 6, 7, 8], Y: [9] }
  ]) {
    const cell = { type: '$bmux', connections };
    const before = JSON.stringify(cell);
    transformYosysNetlist({ modules: { top: { cells: { u: cell } } } });
    assert.equal(JSON.stringify(cell), before);
  }
});

test('skin provides scalar and stacked templates with every input in the body bounds', async () => {
  const skin = await fs.readFile('resources/skins/dark-digital.svg', 'utf8');
  for (const choices of [4, 8, 16, 32]) for (const bus of [false, true]) {
    const type = `binary-mux${choices}${bus ? '-bus' : ''}`;
    const group = skin.match(new RegExp(`<g class="rtl-mux" s:type="${type}"[\\s\\S]*?</g>`))[0];
    const height = Number(group.match(/s:height="([^"]+)"/)[1]);
    assert.ok(group.includes(`val="$binary_mux${choices}${bus ? '-bus' : ''}"`));
    assert.ok(group.includes(`>${choices}:1</text>`));
    for (let i = 0; i < choices; i++) {
      const y = Number(group.match(new RegExp(`s:y="([^"]+)" s:pid="I${i}"`))[1]);
      assert.ok(y > 26 && y < height - 16);
    }
    assert.equal((group.match(/s:pid="I\d+"/g) || []).length, choices);
    assert.ok(group.includes('s:pid="S"'));
    assert.ok(group.includes('s:pid="Y"'));
  }
});

test('gallery renders all four sizes without packed mux data inputs or generic boxes', async () => {
  const pipeline = new RtlPipeline();
  try {
    const result = await pipeline.run(await fs.readFile('examples/mux_gallery.sv', 'utf8'), path.resolve('resources/skins/dark-digital.svg'));
    assert.ok(result.svg, result.errorMessage);
    for (const n of [4, 8, 16, 32]) {
      assert.equal((result.svg.match(new RegExp(`s:type="binary-mux${n}-bus"`, 'g')) || []).length, 1);
      assert.ok(result.svg.includes(`sel${n} [${Math.log2(n) - 1}:0]`));
      assert.ok(result.svg.includes(`out${n} [7:0]`));
    }
    assert.ok(!result.svg.includes('s:type="generic"'));
    assert.ok(result.svg.includes('>/8/</text>'));
    assert.match(result.svg, /viewBox="-\d/); // include long centered input labels
  } finally { await pipeline.dispose(); }
});
