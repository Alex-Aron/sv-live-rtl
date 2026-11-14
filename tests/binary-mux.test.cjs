const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { RTL_SYNTHESIS_PASSES } = require('../out/pipeline');
const execFileAsync = promisify(execFile);

async function checkConversion(source, top, inspect = () => {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rtl-binary-mux-'));
  try {
    const input = path.join(dir, 'input.sv');
    const json = path.join(dir, 'result.json');
    const script = path.join(dir, 'check.ys');
    await fs.writeFile(input, source);
    // Compare the unchanged proc/opt_clean netlist to the exact pass sequence
    // used by the extension, before adding any presentation-only cell aliases.
    await fs.writeFile(script, `
read_verilog -sv "${input}"
hierarchy -top ${top}
proc
opt_clean
rename ${top} gold
design -stash gold
read_verilog -sv "${input}"
hierarchy -top ${top}
${RTL_SYNTHESIS_PASSES}
write_json "${json}"
rename ${top} gate
design -stash gate
design -copy-from gold -as gold gold
design -copy-from gate -as gate gate
equiv_make gold gate equiv
hierarchy -top equiv
equiv_simple
equiv_status -assert
`);
    await execFileAsync('yosys', ['-Q', '-q', '-s', script], { maxBuffer: 2 * 1024 * 1024 });
    const netlist = JSON.parse(await fs.readFile(json, 'utf8'));
    inspect(netlist.modules[top]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('ALU retains one 8-bit 8:1 binary mux and is formally equivalent', async () => {
  await checkConversion(await fs.readFile('examples/alu_bus.sv', 'utf8'), 'alu_bus', (module) => {
    const cells = Object.values(module.cells);
    const muxes = cells.filter(c => c.type === '$bmux');
    assert.equal(muxes.length, 1);
    assert.ok(!cells.some(c => ['$pmux', '$shiftx', '$mux', '$eq'].includes(c.type)));
    const mux = muxes[0];
    assert.equal(mux.connections.A.length, 64);
    assert.equal(mux.connections.Y.length, 8);
    assert.deepEqual(mux.connections.S, module.ports.op.bits);
    assert.equal(module.ports.result.bits.length, 8);
  });
});

test('binary mux conversion preserves overlapping priority case patterns', async () => {
  await checkConversion(`
module priority_case(input [1:0] op, input [7:0] a, b, c, output reg [7:0] y);
  always @* casez (op)
    2'b0?: y = a;
    2'b?0: y = b;
    default: y = c;
  endcase
endmodule
`, 'priority_case');
});

test('binary mux conversion preserves sparse cases and their default result', async () => {
  await checkConversion(`
module sparse_case(input [3:0] op, input [7:0] a, b, c, output reg [7:0] y);
  always @* case (op)
    4'd0: y = a;
    4'd3: y = b;
    4'd12: y = c;
    default: y = 8'h5a;
  endcase
endmodule
`, 'sparse_case', (module) => {
    assert.ok(!Object.values(module.cells).some(c => c.type === '$pmux'));
  });
});

test('gallery retains all four mux sizes and is formally equivalent', async () => {
  await checkConversion(await fs.readFile('examples/mux_gallery.sv', 'utf8'), 'mux_gallery', (module) => {
    const muxes = Object.values(module.cells).filter(c => c.type === '$bmux');
    assert.equal(muxes.length, 4);
    assert.deepEqual(muxes.map(c => c.connections.S.length).sort(), [2, 3, 4, 5]);
    for (const mux of muxes) {
      const n = 2 ** mux.connections.S.length;
      assert.deepEqual(mux.connections.S, module.ports[`sel${n}`].bits);
      assert.deepEqual(mux.connections.A, module.ports[`data${n}`].bits);
      assert.deepEqual(mux.connections.Y, module.ports[`out${n}`].bits);
    }
  });
});

test('muxes above 32:1 fall back to ordinary mux trees and remain equivalent', async () => {
  await checkConversion(`
module mux64(input [511:0] data, input [5:0] sel, output [7:0] y);
  assign y = data[{sel, 3'b000} +: 8];
endmodule
`, 'mux64', (module) => {
    const cells = Object.values(module.cells);
    assert.ok(!cells.some(c => c.type === '$bmux'));
    assert.equal(cells.filter(c => c.type === '$mux').length, 63);
  });
});
