const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { transformYosysNetlist } = require('../out/netlistTransform');
const { RtlPipeline } = require('../out/pipeline');

function transformCell(type, connections) {
  const cell = { type, connections, parameters: { WIDTH: '00001000' } };
  const originalConnections = structuredClone(connections);
  const originalParameters = structuredClone(cell.parameters);
  const netlist = { modules: { top: { cells: { u: cell } } } };
  transformYosysNetlist(netlist);
  assert.deepEqual(cell.connections, originalConnections);
  assert.deepEqual(cell.parameters, originalParameters);
  const once = JSON.stringify(netlist);
  transformYosysNetlist(netlist);
  assert.equal(JSON.stringify(netlist), once);
  return cell;
}

test('multi-bit muxes select the existing stacked aliases', () => {
  for (const type of ['$mux', '$pmux', '$_MUX_']) {
    assert.equal(transformCell(type, { A: [2, 3], B: [4, 5], S: [6], Y: [7, 8] }).type, type + '-bus');
  }
});

test('stacking uses data output width rather than select or concatenated input width', () => {
  assert.equal(transformCell('$pmux', { A: [2], B: [3, 4, 5], S: [6, 7, 8], Y: [9] }).type, '$pmux');
  assert.equal(transformCell('$dff', { D: [2], Q: [3], CLK: [4] }).type, '$dff');
});

test('multi-bit flop variants retain clock and reset connections', () => {
  for (const type of ['$dff', '$adff', '$sdff', '$dffn', '$_DFF_', '$_DFF_P_', '$_DFF_N_']) {
    const connections = { D: [2, 3], Q: [4, 5], [type.startsWith('$_') ? 'C' : 'CLK']: [6] };
    if (type === '$adff') connections.ARST = [7];
    if (type === '$sdff') connections.SRST = [7];
    assert.equal(transformCell(type, connections).type, type + '-bus');
  }
});

test('unsupported interfaces and module instances keep their existing symbols', () => {
  for (const type of ['$dffe', '$adffe', 'my_register']) {
    assert.equal(transformCell(type, { D: [2, 3], Q: [4, 5], CLK: [6], EN: [7] }).type, type);
  }
  assert.equal(transformCell('$dff', { D: [2, 3], Q: [4, 5], CLK: [6], EXTRA: [7] }).type, '$dff');
});

test('real synthesis renders both stacked and scalar mux/flop symbols in one schematic', async () => {
  const pipeline = new RtlPipeline();
  try {
    const result = await pipeline.run(`
module mixed_widths (
  input clk, sel, c, d,
  input [7:0] a, b,
  output reg [7:0] q,
  output reg r
);
  always @(posedge clk) begin
    q <= sel ? a : b;
    r <= sel ? c : d;
  end
endmodule
`, path.resolve('resources/skins/dark-digital.svg'));
    assert.ok(result.svg, result.errorMessage);
    for (const type of ['mux', 'mux-bus', 'dff', 'dff-bus']) {
      assert.ok(result.svg.includes(`s:type="${type}"`), `missing ${type}`);
    }
    assert.ok(result.svg.includes('q [7:0]'));
    assert.ok(result.svg.includes('>/8/</text>'));
  } finally { await pipeline.dispose(); }
});

test('async reset register renders with a stacked symbol and its reset port', async () => {
  const pipeline = new RtlPipeline();
  try {
    const result = await pipeline.run(`
module async_bank(input clk, rst, input [7:0] d, output reg [7:0] q);
  always @(posedge clk or posedge rst)
    if (rst) q <= 8'b0;
    else q <= d;
endmodule
`, path.resolve('resources/skins/dark-digital.svg'));
    assert.ok(result.svg, result.errorMessage);
    assert.ok(result.svg.includes('s:type="dff-bus"'));
    assert.ok(result.svg.includes('s:pid="ARST"'));
    assert.ok(!result.svg.includes('s:type="generic"'));
  } finally { await pipeline.dispose(); }
});
