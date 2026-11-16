const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ProjectPipeline, canonicalRtlil, splitRtlil } = require('../out/projectPipeline');
const skin = path.resolve('resources/skins/dark-digital.svg');
async function example() {
  const dir = path.resolve('examples/project');
  return Promise.all((await fs.readdir(dir)).filter(n => /\.svh?$/.test(n)).map(async n => ({ path: path.join(dir, n), content: await fs.readFile(path.join(dir, n), 'utf8') })));
}
const byName = (snapshot, name) => snapshot.modules.filter(m => m.name === name);

test('project caches leaves independently, preserves parents, resolves includes/parameters, and recovers after errors', async () => {
  const pipeline = new ProjectPipeline();
  try {
    const sources = await example();
    const first = await pipeline.runProject(sources, 'project_demo', skin);
    assert.ok(first.ok, first.error);
    assert.equal(first.modules.length, 5);
    assert.equal(byName(first, 'demo_alu').length, 2);
    const top = byName(first, 'project_demo')[0];
    const stage = byName(first, 'demo_stage')[0];
    assert.equal(top.instances.length, 3);
    assert.equal(top.instances[0].module, top.instances[1].module);
    assert.equal(stage.instances.length, 2);
    assert.ok(top.svg.includes('rtl-module-instance'));
    assert.ok(stage.svg.includes('project-boundary'));
    const unchanged = await pipeline.runProject(sources, 'project_demo', skin);
    assert.ok(unchanged.ok, unchanged.error);
    assert.deepEqual(unchanged.stats.synthesized, []);
    assert.deepEqual(unchanged.stats.rendered, []);
    const alu = sources.find(s => s.path.endsWith('demo_alu.sv'));
    // The example is editable: choose a genuinely different expression even
    // when a user has already changed the original XOR operation (e.g. XNOR).
    const branch = alu.content.match(/2'b11:\s*y\s*=\s*([^;]+);/);
    assert.ok(branch, 'the demo ALU must have its 11 case');
    const replacement = branch[1].replace(/\s/g, '') === 'a^b' ? 'a | b' : 'a ^ b';
    alu.content = alu.content.replace(branch[0], `2'b11: y = ${replacement};`);
    const edited = await pipeline.runProject(sources, 'project_demo', skin);
    assert.ok(edited.ok, edited.error);
    assert.equal(edited.stats.synthesized.length, 2); // both parameter variants
    assert.equal(edited.stats.rendered.length, 2);
    assert.ok(edited.stats.synthesized.every(key => byName(edited, 'demo_alu').some(m => m.key === key)));
    for (const name of ['project_demo', 'demo_stage', 'demo_register']) {
      assert.equal(byName(edited, name)[0].revision, byName(first, name)[0].revision);
      assert.equal(byName(edited, name)[0].svg, byName(first, name)[0].svg);
    }
    for (const old of byName(first, 'demo_alu')) {
      const updated = edited.modules.find(m => m.key === old.key);
      assert.equal(updated.width, old.width);
      assert.equal(updated.height, old.height);
      assert.notEqual(updated.revision, old.revision);
    }
    const valid = alu.content;
    alu.content = 'module invalid syntax';
    const failed = await pipeline.runProject(sources, 'project_demo', skin);
    assert.equal(failed.ok, false);
    assert.equal(failed.modules, undefined);
    assert.ok(failed.error);
    assert.ok(failed.diagnostics.some(d => d.file === alu.path && d.severity === 'Error'));
    alu.content = valid;
    const recovered = await pipeline.runProject(sources, 'project_demo', skin);
    assert.ok(recovered.ok, recovered.error);
    assert.deepEqual(recovered.stats.rendered, []);
    const reflow = await pipeline.runProject(sources, 'project_demo', skin, true);
    assert.ok(reflow.ok, reflow.error);
    assert.deepEqual(reflow.stats.synthesized, []);
    assert.equal(reflow.stats.rendered.length, 5);
  } finally { await pipeline.dispose(); }
});

test('interface changes invalidate the owning module and its direct parent', async () => {
  const pipeline = new ProjectPipeline();
  const sources = [
    { path: '/tmp/project-test/child.sv', content: 'module child(input [7:0] a, output [7:0] y); assign y=a; endmodule' },
    { path: '/tmp/project-test/top.sv', content: 'module top(input [7:0] a, output [7:0] y); child u(.a(a),.y(y)); endmodule' }
  ];
  try {
    const first = await pipeline.runProject(sources, 'top', skin);
    assert.ok(first.ok, first.error);
    sources[0].content = sources[0].content.replace('input [7:0] a,', 'input [7:0] a, input en,');
    const changed = await pipeline.runProject(sources, 'top', skin);
    assert.ok(changed.ok, changed.error);
    assert.deepEqual(changed.stats.synthesized.sort(), ['child', 'top']);
    assert.deepEqual(changed.stats.rendered.sort(), ['child', 'top']);
  } finally { await pipeline.dispose(); }
});

test('anonymous allocation/source-line changes do not invalidate unrelated modules', async () => {
  const pipeline = new ProjectPipeline();
  const source = { path: '/tmp/project-test/all.sv', content: `
module a_leaf(input [7:0] a,b,output [7:0] y);assign y=a+b;endmodule
module z_leaf(input [7:0] a,b,output [7:0] y);assign y=a^b;endmodule
module top(input [7:0] a,b,output [7:0] y,z);a_leaf one(a,b,y);z_leaf two(a,b,z);endmodule` };
  try {
    const first = await pipeline.runProject([source], 'top', skin);
    assert.ok(first.ok, first.error);
    source.content = source.content.replace('a+b', '(a+b) & (a|b)');
    const updated = await pipeline.runProject([source], 'top', skin);
    assert.ok(updated.ok, updated.error);
    assert.deepEqual(updated.stats.synthesized, ['a_leaf']);
    assert.deepEqual(updated.stats.rendered, ['a_leaf']);
  } finally { await pipeline.dispose(); }
});

test('RTLIL splitting respects nested processes; canonicalization preserves cell types', () => {
  const block = 'attribute \\src "old:1"\nmodule \\m\n  wire width 8 input 1 \\a\n  process $proc$old:1$99\n    sync always\n  end\n  cell $add $add$old:1$12\n  end\nend';
  assert.equal(splitRtlil(block).length, 1);
  assert.ok(splitRtlil(block)[0].stub.includes('wire width 8 input 1 \\a'));
  const moved = block.replaceAll('old:1', 'new:9').replace('$99', '$23').replace('$12', '$87');
  assert.equal(canonicalRtlil(block), canonicalRtlil(moved));
  assert.notEqual(canonicalRtlil(block), canonicalRtlil(block.replace('cell $add', 'cell $sub')));
});

test('port stubs preserve explicit single-bit vector attributes and display names', async () => {
  const pipeline = new ProjectPipeline();
  try {
    const result = await pipeline.runProject([
      { path: '/tmp/project-test/leaf.sv', content: 'module leaf(input [0:0] d,output [0:0] q);assign q=~d;endmodule' },
      { path: '/tmp/project-test/top.sv', content: 'module top(input [0:0] d,output [0:0] q);leaf u(.d(d),.q(q));endmodule' }
    ], 'top', skin);
    assert.ok(result.ok, result.error);
    const leaf = result.modules.find(m => m.key === 'leaf');
    const top = result.modules.find(m => m.key === 'top');
    assert.equal(leaf.ports[0].label, 'd [0:0]');
    assert.ok(top.svg.includes('s:pid="d [0:0]"'));
    assert.ok(leaf.svg.includes('cell_d [0:0]'));
  } finally { await pipeline.dispose(); }
});

test('declared external black boxes retain their ports and cannot expand', async () => {
  const pipeline = new ProjectPipeline();
  try {
    const result = await pipeline.runProject([
      { path: '/tmp/project-test/external.sv', content: '(* blackbox *) module external(input [7:0] a,output [7:0] y);endmodule' },
      { path: '/tmp/project-test/top.sv', content: 'module top(input [7:0] a,output [7:0] y);external u(.a(a),.y(y));endmodule' }
    ], 'top', skin);
    assert.ok(result.ok, result.error);
    const external = result.modules.find(m => m.key === 'external');
    assert.equal(external.blackbox, true);
    assert.equal(external.ports.length, 2);
    assert.deepEqual(external.instances, []);
  } finally { await pipeline.dispose(); }
});

test('collapsed hierarchy is compact; independent expansion only lays out affected ancestors', async () => {
  const pipeline = new ProjectPipeline();
  try {
    const sources = await example();
    const built = await pipeline.runProject(sources, 'project_demo', skin);
    assert.ok(built.ok, built.error);
    const closed = await pipeline.layoutProject('project_demo', []);
    assert.ok(closed.ok, closed.error);
    const rootOf = result => result.modules.find(m => m.key === result.viewRoot);
    const size = m => +m.svg.match(/\bwidth="([^"]+)"/)[1] * +m.svg.match(/\bheight="([^"]+)"/)[1];
    const initialArea = size(rootOf(closed));
    const opened = await pipeline.layoutProject('project_demo', ['project_demo/left_stage']);
    assert.ok(opened.ok, opened.error);
    assert.deepEqual(opened.stats.synthesized, []);
    assert.ok(size(rootOf(opened)) > initialArea);
    const frames = [...rootOf(opened).svg.matchAll(/<g class="rtl-module-instance"[^>]*>/g)].map(m => m[0]);
    const left = frames.find(g => g.includes('id="cell_left_stage"'));
    const right = frames.find(g => g.includes('id="cell_right_stage"'));
    assert.ok(+left.match(/s:width="([^"]+)"/)[1] > +right.match(/s:width="([^"]+)"/)[1]);
    const deeper = await pipeline.layoutProject('project_demo', ['project_demo/left_stage', 'project_demo/left_stage/arithmetic']);
    assert.ok(deeper.ok, deeper.error);
    assert.ok(size(rootOf(deeper)) > size(rootOf(opened)));
    assert.deepEqual(deeper.stats.synthesized, []);
    const again = await pipeline.layoutProject('project_demo', []);
    assert.ok(again.ok, again.error);
    assert.equal(size(rootOf(again)), initialArea);
    assert.deepEqual(again.stats.synthesized, []);
    const stable = await pipeline.layoutProject('project_demo', []);
    assert.deepEqual(stable.stats.rendered, []);
  } finally { await pipeline.dispose(); }
});

test('logic-only edits in expanded scenes preserve ancestor SVGs and frame geometry', async () => {
  const pipeline = new ProjectPipeline();
  try {
    const sources = await example();
    const build = await pipeline.runProject(sources, 'project_demo', skin);
    assert.ok(build.ok, build.error);
    const paths = ['project_demo/left_stage', 'project_demo/left_stage/arithmetic'];
    const first = await pipeline.layoutProject('project_demo', paths);
    assert.ok(first.ok, first.error);
    const alu = sources.find(s => s.path.endsWith('demo_alu.sv'));
    alu.content = alu.content.replace('a + b', 'a - b');
    const changed = await pipeline.runProject(sources, 'project_demo', skin);
    assert.ok(changed.ok, changed.error);
    const next = await pipeline.layoutProject('project_demo', paths);
    assert.ok(next.ok, next.error);
    const rootBefore = first.modules.find(m => m.key === first.viewRoot);
    const rootAfter = next.modules.find(m => m.key === next.viewRoot);
    assert.equal(rootAfter.svg, rootBefore.svg);
    const stageBefore = first.modules.find(m => m.baseKey && m.name === 'demo_stage');
    const stageAfter = next.modules.find(m => m.key === stageBefore.key);
    assert.equal(stageAfter.svg, stageBefore.svg);
    assert.equal(stageAfter.width, stageBefore.width);
    assert.equal(stageAfter.height, stageBefore.height);
  } finally { await pipeline.dispose(); }
});
