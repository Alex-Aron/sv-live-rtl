const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { transformYosysNetlist, postProcessSvgBuses } = require('../out/netlistTransform');
const { RtlPipeline } = require('../out/pipeline');

describe('Feature B: transformYosysNetlist', () => {
  test('handles null or invalid netlists gracefully', () => {
    assert.equal(transformYosysNetlist(null), null);
    assert.deepEqual(transformYosysNetlist({}), {});
    assert.deepEqual(transformYosysNetlist({ modules: {} }), { modules: {} });
  });

  test('keeps single-bit scalar ports unchanged', () => {
    const netlist = {
      modules: {
        top: {
          ports: {
            clk: { direction: 'input', bits: [2] },
            rst: { direction: 'input', bits: [3] }
          },
          netnames: {
            clk: { bits: [2] },
            rst: { bits: [3] }
          }
        }
      }
    };
    const transformed = transformYosysNetlist(netlist);
    assert.ok(transformed.modules.top.ports['clk']);
    assert.ok(transformed.modules.top.ports['rst']);
    assert.equal(transformed.modules.top.ports['clk [0:0]'], undefined);
  });

  test('renames standard descending multi-bit bus to [N-1:0]', () => {
    const netlist = {
      modules: {
        counter: {
          ports: {
            count: { direction: 'output', bits: [5, 6, 7, 8] }
          },
          netnames: {
            count: { bits: [5, 6, 7, 8] }
          }
        }
      }
    };
    const transformed = transformYosysNetlist(netlist);
    assert.equal(transformed.modules.counter.ports['count'], undefined);
    assert.ok(transformed.modules.counter.ports['count [3:0]']);
    assert.deepEqual(transformed.modules.counter.ports['count [3:0]'].bits, [5, 6, 7, 8]);
    assert.ok(transformed.modules.counter.netnames['count [3:0]']);
  });

  test('handles bus with offset (e.g. [7:4])', () => {
    const netlist = {
      modules: {
        top: {
          ports: {
            in_a: { direction: 'input', offset: 4, bits: [2, 3, 4, 5] }
          },
          netnames: {
            in_a: { offset: 4, bits: [2, 3, 4, 5] }
          }
        }
      }
    };
    const transformed = transformYosysNetlist(netlist);
    assert.ok(transformed.modules.top.ports['in_a [7:4]']);
    assert.equal(transformed.modules.top.ports['in_a'], undefined);
  });

  test('handles bus with upto notation (e.g. [0:3])', () => {
    const netlist = {
      modules: {
        top: {
          ports: {
            in_b: { direction: 'input', upto: 1, bits: [6, 7, 8, 9] }
          },
          netnames: {
            in_b: { upto: 1, bits: [6, 7, 8, 9] }
          }
        }
      }
    };
    const transformed = transformYosysNetlist(netlist);
    assert.ok(transformed.modules.top.ports['in_b [0:3]']);
    assert.equal(transformed.modules.top.ports['in_b'], undefined);
  });

  test('handles bus with offset and upto (e.g. [4:7])', () => {
    const netlist = {
      modules: {
        top: {
          ports: {
            in_c: { direction: 'input', offset: 4, upto: 1, bits: [6, 7, 8, 9] }
          }
        }
      }
    };
    const transformed = transformYosysNetlist(netlist);
    assert.ok(transformed.modules.top.ports['in_c [4:7]']);
  });

  test('handles explicit 1-bit vector declared with single_bit_vector attribute', () => {
    const netlist = {
      modules: {
        top: {
          ports: {
            v1: { direction: 'input', bits: [2] }
          },
          netnames: {
            v1: {
              bits: [2],
              attributes: { single_bit_vector: '00000000000000000000000000000001' }
            }
          }
        }
      }
    };
    const transformed = transformYosysNetlist(netlist);
    assert.ok(transformed.modules.top.ports['v1 [0:0]']);
  });

  test('does not duplicate range if port already has brackets', () => {
    const netlist = {
      modules: {
        top: {
          ports: {
            'data [7:0]': { direction: 'input', bits: [2, 3, 4, 5, 6, 7, 8, 9] }
          }
        }
      }
    };
    const transformed = transformYosysNetlist(netlist);
    assert.ok(transformed.modules.top.ports['data [7:0]']);
    assert.equal(transformed.modules.top.ports['data [7:0] [7:0]'], undefined);
  });
});

test('port ranges preserve hierarchical instance connections and are idempotent', () => {
  const netlist = { modules: {
    child: { ports: { data: { direction: 'input', bits: [2, 3, 4, 5], offset: '4' } } },
    top: { cells: { u: { type: 'child', connections: { data: [8, 9, 10, 11] }, port_directions: { data: 'input' } } } }
  } };
  transformYosysNetlist(netlist);
  assert.deepEqual(netlist.modules.top.cells.u.connections['data [7:4]'], [8, 9, 10, 11]);
  assert.equal(netlist.modules.top.cells.u.port_directions['data [7:4]'], 'input');
  assert.equal(netlist.modules.top.cells.u.connections.data, undefined);
  const once = JSON.stringify(netlist);
  transformYosysNetlist(netlist);
  assert.equal(JSON.stringify(netlist), once);
});

describe('Feature B: inline bus labels' , () => {
  const net = 'net_2,3,4,5';
  const line = (x1, y1, x2, y2, cls = net) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`;
  const wrap = (content) => `<svg class="rtl-schematic"><style></style>${content}</svg>`;
  const labels = (svg) => [...svg.matchAll(/<text x="([^"]+)" y="([^"]+)" class="bus-label/g)].map(m => [+m[1], +m[2]]);
  const wireLines = (svg) => [...svg.matchAll(/<line[^>]*>/g)].map(m => Object.fromEntries([...m[0].matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1], a[2]])));

  test('cuts a real centered gap with /N/ inline and no tick or background mask', () => {
    const result = postProcessSvgBuses(wrap(line(0, 50, 100, 50)));
    assert.deepEqual(labels(result), [[50, 50]]);
    const lines = wireLines(result);
    assert.equal(lines.length, 2);
    assert.equal(+lines[0].x1, 0);
    assert.equal(+lines[1].x2, 100);
    // Three estimated 6.5-unit characters, plus 1 unit of padding per side.
    assert.equal(+lines[0].x2, 39.25);
    assert.equal(+lines[1].x1, 60.75);
    assert.ok(!result.includes('bus-tick'));
    assert.ok(!result.includes('<rect'));
    assert.ok(result.includes('>/4/</text>'));
  });

  test('vertical connections have a gap and centered readable label', () => {
    const result = postProcessSvgBuses(wrap(line(60, 0, 60, 100)));
    assert.deepEqual(labels(result), [[60, 50]]);
    const lines = wireLines(result);
    assert.equal(+lines[0].y2, 42.5);
    assert.equal(+lines[1].y1, 57.5);
  });

  test('uses the routed midpoint through bends rather than fixed coordinate bonuses', () => {
    const result = postProcessSvgBuses(wrap(line(10, 10, 110, 10) + line(110, 10, 110, 30) + line(110, 30, 130, 30)));
    assert.deepEqual(labels(result), [[80, 10]]); // 70 along a 140-unit route
  });

  test('deduplicates reverse/shared segments and cuts all copies', () => {
    const result = postProcessSvgBuses(wrap(line(0, 50, 100, 50) + line(100, 50, 0, 50)));
    assert.equal(labels(result).length, 1);
    for (const l of wireLines(result)) assert.ok(!(+l.x1 < 50 && +l.x2 > 50));
  });

  test('preserves branch junctions and places labels on connections away from dots', () => {
    const result = postProcessSvgBuses(wrap(line(0, 50, 200, 50) + line(100, 50, 100, 150) + `<circle cx="100" cy="50" r="2" class="${net}"/>`));
    assert.equal(labels(result).length, 3);
    for (const [x, y] of labels(result)) assert.ok(Math.hypot(x - 100, y - 50) > 20);
    assert.ok(result.includes('circle.bus'));
  });

  test('avoids translated component labels, nested port text, and other wires', () => {
    const obstacles = `<g s:type="join" s:width="5" s:height="40" transform="translate(130,30)"><rect width="5" height="40"/><g transform="translate(0,24)"><text x="-3" y="0" class="inputPortLabel">15:0</text></g></g>`;
    const result = postProcessSvgBuses(wrap(line(0, 50, 130, 50) + line(65, 20, 65, 80, 'net_9') + obstacles));
    assert.equal(labels(result).length, 1);
    const [x, y] = labels(result)[0];
    assert.equal(y, 50);
    assert.ok(Math.abs(x - 65) > 15 && x < 80);
  });

  test('does not force labels onto short segments or single-bit nets', () => {
    const result = postProcessSvgBuses(wrap(line(0, 10, 20, 10) + line(0, 30, 100, 30, 'net_9')));
    assert.equal(labels(result).length, 0);
    assert.equal(wireLines(result).length, 2);
    assert.ok(result.includes('net_9 width_1'));
  });

  test('keeps short bus runs solid between pins and junctions', () => {
    const shortRuns = [
      [12, 20, 50, 20],
      [50, 20, 90, 20],
      [50, 20, 50, 75],
      [50, 75, 90, 75],
      [90, 75, 90, 90]
    ];
    const dots = [20, 75].map(y => `<circle cx="50" cy="${y}" r="2" class="${net}"/>`);
    const svg = wrap([...shortRuns.map(points => line(...points)), line(50, 75, 50, 135), ...dots].join(''));
    const result = postProcessSvgBuses(svg);
    assert.deepEqual(labels(result), [[50, 105]]);
    const lines = wireLines(result);
    for (const [x1, y1, x2, y2] of shortRuns) {
      assert.ok(lines.some(w => +w.x1 === x1 && +w.y1 === y1 && +w.x2 === x2 && +w.y2 === y2 && w.class === `${net} width_4 bus`));
    }
  });

  test('short spans between visible crossing jumps get no labels on either wire axis', () => {
    const horizontal = postProcessSvgBuses(wrap(
      line(0, 50, 135, 50) + line(45, 0, 45, 100, 'net_6') + line(90, 0, 90, 100, 'net_7')));
    const vertical = postProcessSvgBuses(wrap(
      line(50, 0, 50, 135) + line(0, 45, 100, 45, 'net_6') + line(0, 90, 100, 90, 'net_7')));
    for (const result of [horizontal, vertical]) {
      assert.deepEqual(labels(result), []);
      assert.equal((result.match(/ wire-jump"/g) || []).length, 2);
      assert.doesNotMatch(result, /<circle/);
    }
    assert.ok(wireLines(vertical).some(w => +w.x1 === 50 && +w.y1 === 0 && +w.y2 === 135));
  });

  test('a crossing can move the label to a longer span without adding labels to the route', () => {
    const result = postProcessSvgBuses(wrap(
      line(0, 50, 225, 50) + line(90, 0, 90, 100, 'net_6') + line(135, 0, 135, 100, 'net_7')));
    const placed = labels(result);
    assert.equal(placed.length, 1);
    assert.ok(placed[0][0] < 90 || placed[0][0] > 135);
    assert.equal((result.match(/ wire-jump"/g) || []).length, 2);
  });
});

describe('Feature B: End-to-End RtlPipeline with Custom Skin', () => {
  test('synthesizes counter.sv with dark-digital skin and generates bus widths and slash notation', async () => {
    const pipeline = new RtlPipeline();
    await pipeline.init();

    const skinPath = path.resolve(__dirname, '../resources/skins/dark-digital.svg');
    const counterPath = path.resolve(__dirname, '../examples/counter.sv');
    const svCode = await fs.readFile(counterPath, 'utf8');

    const result = await pipeline.run(svCode, skinPath);

    try {
      assert.equal(result.lintPassed, true, `Pipeline failed: ${result.errorMessage}`);
      assert.ok(result.svg, 'SVG should be returned');

      const svg = result.svg;

      // 1. Port label must contain detailed bit-range: count [3:0]
      assert.ok(
        svg.includes('count [3:0]'),
        'SVG should contain transformed vector port label "count [3:0]"'
      );

      // 2. Bus wires must have `bus` and `width_4` classes
      assert.ok(
        svg.includes('width_4 bus'),
        'SVG should contain multi-bit wires decorated with "width_4 bus"'
      );

      // 3. Single-bit wires must have `width_1` class
      assert.ok(
        svg.includes('width_1'),
        'SVG should contain single-bit wires decorated with "width_1"'
      );

      // 4. Schematic should have inline indicators with /4/
      assert.ok(
        svg.includes('<g class="bus-indicators">'),
        'SVG should contain bus indicators group'
      );
      assert.ok(
        !svg.includes('bus-tick'),
        'SVG should contain no diagonal ticks'
      );
      assert.ok(
        svg.includes('class="bus-label width_4"'),
        'SVG should contain bus-label elements'
      );
      assert.ok(
        svg.includes('>/4/<'),
        'SVG should render /4/ text notation'
      );

      // 5. Embedded CSS must include thicker bus lines and tick styling
      assert.ok(
        svg.includes('line.bus {'),
        'SVG CSS should include line.bus rule'
      );
      assert.ok(
        svg.includes('stroke-width: 2.5px;'),
        'line.bus rule should specify stroke-width: 2.5px'
      );
    } finally {
      await pipeline.dispose();
    }
  });

  test('synthesizes multi-bit split/join module with multiple bus widths', async () => {
    const pipeline = new RtlPipeline();
    await pipeline.init();

    const skinPath = path.resolve(__dirname, '../resources/skins/dark-digital.svg');
    const code = `
module split_buses (
    input  logic [7:0] data_in,
    output logic [3:0] upper,
    output logic [3:0] lower,
    output logic       valid
);
    assign upper = data_in[7:4];
    assign lower = data_in[3:0];
    assign valid = data_in[0];
endmodule
`;

    const result = await pipeline.run(code, skinPath);

    try {
      assert.equal(result.lintPassed, true, `Pipeline failed: ${result.errorMessage}`);
      assert.ok(result.svg, 'SVG should be returned');

      const svg = result.svg;

      // Port labels
      assert.ok(svg.includes('data_in [7:0]'), 'Should contain "data_in [7:0]"');
      assert.ok(svg.includes('upper [3:0]'), 'Should contain "upper [3:0]"');
      assert.ok(svg.includes('lower [3:0]'), 'Should contain "lower [3:0]"');
      assert.ok(svg.includes('valid'), 'Should contain "valid" without range');

      // Both width 8 and width 4 bus classes
      assert.ok(svg.includes('width_8 bus'), 'Should contain width_8 bus');
      assert.ok(svg.includes('width_4 bus'), 'Should contain width_4 bus');
      assert.ok(svg.includes('width_1'), 'Should contain width_1');

      // Bus slashes for 8 and 4
      assert.ok(svg.includes('>/8/<'), 'Should contain /8/ bus notation');
      assert.ok(svg.includes('>/4/<'), 'Should contain /4/ bus notation');
    } finally {
      await pipeline.dispose();
    }
  });
});

test('the ALU example renders inline widths without any wire crossing a label center', async () => {
  const pipeline = new RtlPipeline();
  try {
    const result = await pipeline.run(await fs.readFile(path.resolve('examples/alu_bus.sv'), 'utf8'), path.resolve('resources/skins/dark-digital.svg'));
    assert.ok(result.svg, result.errorMessage);
    assert.ok(result.svg.includes('>/8/</text>'));
    assert.ok(!result.svg.includes('width_32'), 'ALU muxes should have separate 8-bit data inputs');
    assert.equal((result.svg.match(/s:type="binary-mux8-bus"/g) || []).length, 1, 'ALU should use one 8:1 binary mux');
    assert.ok(!result.svg.includes('bus-tick'));
    const lines = [...result.svg.matchAll(/<line\b([^>]*)>/g)].map(m => Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1], a[2]]))).filter(a => a.class?.startsWith('net_'));
    for (const m of result.svg.matchAll(/<text x="([^"]+)" y="([^"]+)" class="bus-label/g)) {
      const x = +m[1], y = +m[2];
      for (const l of lines) {
        const minX = Math.min(+l.x1, +l.x2), maxX = Math.max(+l.x1, +l.x2);
        const minY = Math.min(+l.y1, +l.y2), maxY = Math.max(+l.y1, +l.y2);
        assert.ok(!(x >= minX && x <= maxX && y >= minY && y <= maxY), 'label center must be in a wire gap');
      }
    }
  } finally { await pipeline.dispose(); }
});
