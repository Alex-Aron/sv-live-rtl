const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const { RTL_SYNTHESIS_PASSES } = require('../out/pipeline');
const { transformYosysNetlist, postProcessSvgBuses } = require('../out/netlistTransform');
const skin = path.resolve('resources/skins/dark-digital.svg');

async function withTemporaryDirectory(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rtl-memory-test-'));
  try { await run(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

async function render(directory, json) {
  const jsonPath = path.join(directory, 'netlist.json');
  const svgPath = path.join(directory, 'netlist.svg');
  await fs.writeFile(jsonPath, JSON.stringify(transformYosysNetlist(json)));
  await execFileAsync('netlistsvg', [jsonPath, '-o', svgPath, '--skin', skin]);
  return postProcessSvgBuses(await fs.readFile(svgPath, 'utf8'));
}

test('RISC-V RAM renders distinct memory read/write ports and keeps its per-bit enable mask', async () => {
  await withTemporaryDirectory(async directory => {
    const jsonPath = path.join(directory, 'ram.json');
    await execFileAsync('yosys', ['-q', '-p', [
      'read_verilog -sv -Iexamples/risc_example examples/risc_example/riscv_ram.sv',
      'hierarchy -top riscv_ram', RTL_SYNTHESIS_PASSES, `write_json "${jsonPath}"`
    ].join('; ')]);
    const json = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    const module = json.modules.riscv_ram;
    const write = Object.values(module.cells).find(cell => cell.type === '$memwr_v2');
    const read = Object.values(module.cells).find(cell => cell.type === '$memrd');
    assert.ok(read && write, 'example should retain Yosys memory port cells');
    assert.equal(module.ports.we.bits.length, 1, 'RTL has a scalar whole-word enable');
    assert.equal(parseInt(write.parameters.WIDTH, 2), 32);
    assert.equal(write.connections.EN.length, 32);
    assert.equal(new Set(write.connections.EN).size, 1, 'whole-word write replicates one control to all 32 mask bits');
    assert.equal(read.connections.EN.length, 1, 'read enable is scalar');
    const before = structuredClone({ read: read.connections, write: write.connections, parameters: write.parameters });
    const svg = await render(directory, json);
    assert.deepEqual({ read: read.connections, write: write.connections, parameters: write.parameters }, before, 'rendering must preserve memory parameters and every mask bit');
    assert.match(svg, /s:type="memory-read"/);
    assert.match(svg, /s:type="memory-write"/);
    assert.match(svg, />MASK<\/text>/);
    assert.ok(!svg.includes('s:type="generic"'), 'memory ports must use their dedicated symbols');
  });
});

test('legacy/v2 read, write, and initializer cells render every connected pin with its own symbol', async () => {
  await withTemporaryDirectory(async directory => {
    let bit = 2;
    const cells = {}, ports = {};
    const expected = {
      '$memrd': ['memory-read', ['ADDR', 'EN', 'CLK', 'DATA']],
      '$memrd_v2': ['memory-read-v2', ['ADDR', 'EN', 'CLK', 'ARST', 'SRST', 'DATA']],
      '$memwr': ['memory-write', ['ADDR', 'DATA', 'EN', 'CLK']],
      '$memwr_v2': ['memory-write', ['ADDR', 'DATA', 'EN', 'CLK']],
      '$meminit': ['memory-init', ['ADDR', 'DATA']],
      '$meminit_v2': ['memory-init-v2', ['ADDR', 'DATA', 'EN']]
    };
    for (const [type, [, pins]] of Object.entries(expected)) {
      const connections = {}, directions = {};
      for (const pin of pins) {
        const width = pin === 'DATA' || (pin === 'EN' && !type.startsWith('$memrd')) ? 8 : pin === 'ADDR' ? 4 : 1;
        connections[pin] = Array.from({ length: width }, () => bit++);
        directions[pin] = type.startsWith('$memrd') && pin === 'DATA' ? 'output' : 'input';
        ports[`${type.slice(1)}_${pin}`] = { direction: directions[pin], bits: connections[pin] };
      }
      cells[type.slice(1)] = { type, connections, port_directions: directions, parameters: {}, attributes: {} };
    }
    const svg = await render(directory, { modules: { top: { attributes: { top: 1 }, ports, cells, netnames: {} } } });
    assert.ok(!svg.includes('s:type="generic"'));
    for (const [type, [symbol, pins]] of Object.entries(expected)) {
      const node = svg.match(new RegExp(`<g[^>]*s:type="${symbol}"[^>]*id="cell_${type.slice(1)}"[\\s\\S]*?</g>`))?.[0];
      assert.ok(node, `missing ${type} symbol`);
      for (const pin of pins) assert.ok(node.includes(`s:pid="${pin}"`), `missing ${type}.${pin}`);
    }
  });
});
