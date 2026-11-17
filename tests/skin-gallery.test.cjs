const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { RtlPipeline } = require('../out/pipeline');

const skinPath = path.resolve('resources/skins/dark-digital.svg');

test('standalone skin gallery contains every template and caption without overlaps or clipped bounds', async () => {
  const skin = await fs.readFile(skinPath, 'utf8');
  const root = skin.match(/<svg\b[^>]*>/)[0];
  const width = Number(root.match(/\bwidth="([^"]+)"/)[1]);
  const height = Number(root.match(/\bheight="([^"]+)"/)[1]);
  // netlistsvg copies root attributes, so a gallery viewBox would incorrectly
  // constrain actual rendered circuits to this unrelated coordinate system.
  assert.ok(!/\bviewBox=/.test(root));
  const templates = Array.from(skin.matchAll(/<g\b[^>]*\bs:type="([^"]+)"[^>]*>/g), match => {
    const tag = match[0];
    const [, x, y] = tag.match(/transform="translate\(([-\d.]+),\s*([-\d.]+)\)"/).map(Number);
    const w = Number(tag.match(/s:width="([^"]+)"/)[1]);
    const h = Number(tag.match(/s:height="([^"]+)"/)[1]);
    const captionWidth = match[1].length * 6 + 16;
    const bodyMargin = match[1] === 'generic' ? 32 : 20;
    return {
      type: match[1],
      left: Math.min(x - bodyMargin, x + w / 2 - captionWidth / 2),
      right: Math.max(x + w + bodyMargin, x + w / 2 + captionWidth / 2),
      top: y - 34,
      bottom: y + h + 20
    };
  });
  assert.ok(templates.length > 60);
  assert.equal((skin.match(/data-skin-gallery="caption"/g) || []).length, templates.length);
  for (let i = 0; i < templates.length; i++) {
    const a = templates[i];
    assert.ok(a.left >= 0 && a.top >= 0 && a.right <= width && a.bottom <= height, `${a.type} clipped by canvas`);
    for (let j = i + 1; j < templates.length; j++) {
      const b = templates[j];
      const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      assert.ok(!overlap, `${a.type} overlaps ${b.type}`);
    }
  }
});

test('gallery placement and labels are omitted from synthesized circuit rendering', async () => {
  const pipeline = new RtlPipeline();
  try {
    const result = await pipeline.run('module gallery_smoke(input a, output y); assign y = ~a; endmodule', skinPath);
    assert.ok(result.svg, result.errorMessage);
    assert.match(result.svg, /s:type="not"/);
    assert.ok(!result.svg.includes('data-skin-gallery'));
    assert.ok(!result.svg.includes('Digital symbol library'));
    const root = result.svg.match(/<svg\b[^>]*>/)[0];
    assert.ok(Number(root.match(/\bwidth="([^"]+)"/)[1]) < 500);
    assert.ok(Number(root.match(/\bheight="([^"]+)"/)[1]) < 500);
    assert.match(root, /viewBox="/);
  } finally { await pipeline.dispose(); }
});
