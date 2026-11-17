/** Presentation-only wire clearance and crossing marks for netlistsvg's orthogonal SVG. */
interface Point { x: number; y: number }
interface Box { left: number; right: number; top: number; bottom: number }
interface Segment { a: Point; b: Point; attrs: Record<string, string>; net: string }
interface TextLabel { box: Box; source: string; x: number; y: number; selector: boolean }
const EPS = 0.01;
const attrs = (s: string): Record<string, string> => Object.fromEntries([...s.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1], m[2]]));
const netOf = (a: Record<string, string>) => a.class?.split(/\s+/).find(c => /^net_[\w,]+$/.test(c));
const serialize = (a: Record<string, string>) => Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');
const horizontal = (s: Segment) => Math.abs(s.a.y - s.b.y) < EPS;
function intersects(s: Segment, b: Box): boolean {
  return horizontal(s)
    ? s.a.y > b.top && s.a.y < b.bottom && Math.max(s.a.x, s.b.x) > b.left && Math.min(s.a.x, s.b.x) < b.right
    : s.a.x > b.left && s.a.x < b.right && Math.max(s.a.y, s.b.y) > b.top && Math.min(s.a.y, s.b.y) < b.bottom;
}
const contains = (b: Box, p: Point) => p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;

function bounds(svg: string): { texts: Box[]; cells: Box[]; labels: TextLabel[] } {
  const texts: Box[] = [], cells: Box[] = [], stack: (Point & { selector: boolean })[] = [{ x: 0, y: 0, selector: false }];
  const labels: TextLabel[] = [];
  for (const m of svg.matchAll(/<g\b[^>]*>|<\/g\s*>|<text\b[^>]*>[\s\S]*?<\/text>/g)) {
    const token = m[0];
    if (token.startsWith('</g')) { if (stack.length > 1) stack.pop(); continue; }
    const a = attrs(token.slice(0, token.indexOf('>'))), p = stack[stack.length - 1];
    if (token.startsWith('<g')) {
      const t = a.transform?.match(/translate\(\s*([-\d.e+]+)[,\s]+([-\d.e+]+)\s*\)/i);
      const origin = { x: p.x + Number(t?.[1] || 0), y: p.y + Number(t?.[2] || 0),
        selector: p.selector || !!a.class?.split(/\s+/).includes('rtl-selector') };
      if (a['s:type']) cells.push({ left: origin.x - 2, right: origin.x + Number(a['s:width']) + 2,
        top: origin.y - 2, bottom: origin.y + Number(a['s:height']) + 2 });
      if (!token.endsWith('/>')) stack.push(origin);
    } else {
      // Bus labels already have real gaps. Do not route their own wires around them.
      if (a.class?.includes('bus-label')) continue;
      const text = token.slice(token.indexOf('>') + 1, token.lastIndexOf('<')).replace(/&[^;]+;/g, '_');
      if (!text.trim()) continue;
      const width = text.length * 6.5, x = p.x + Number(a.x || 0), y = p.y + Number(a.y || 0);
      const anchor = a['text-anchor'] || (a.class?.includes('nodelabel') ? 'middle' : a.class?.includes('inputPortLabel') ? 'end' : 'start');
      const left = x - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0);
      const box = { left: left - 4, right: left + width + 4, top: y - 12, bottom: y + 5 };
      texts.push(box);
      labels.push({ box, source: token, x, y, selector: p.selector });
    }
  }
  return { texts, cells, labels };
}

/** Keep endpoints untouched, detouring only the section passing through text.
 * Try both sides and refuse a detour through another symbol or label. */
function clearText(s: Segment, texts: Box[], cells: Box[], original: Segment[]): Segment[] {
  const hit = texts.filter(b => intersects(s, b) && !contains(b, s.a) && !contains(b, s.b));
  if (!hit.length) return [s];
  const h = horizontal(s), direction = (h ? s.b.x - s.a.x : s.b.y - s.a.y) > 0 ? 1 : -1;
  const low = Math.min(...hit.map(b => h ? b.left : b.top)) - 4;
  const high = Math.max(...hit.map(b => h ? b.right : b.bottom)) + 4;
  const start = h ? s.a.x : s.a.y, end = h ? s.b.x : s.b.y;
  if (low <= Math.min(start, end) + 2 || high >= Math.max(start, end) - 2) return [s];
  const lanes = h
    ? [Math.min(...hit.map(b => b.top)) - 4, Math.max(...hit.map(b => b.bottom)) + 4]
    : [Math.min(...hit.map(b => b.left)) - 4, Math.max(...hit.map(b => b.right)) + 4];
  lanes.sort((a, b) => Math.abs(a - (h ? s.a.y : s.a.x)) - Math.abs(b - (h ? s.a.y : s.a.x)));
  for (const lane of lanes) {
    const before = direction > 0 ? low : high, after = direction > 0 ? high : low;
    const points = h ? [s.a, { x: before, y: s.a.y }, { x: before, y: lane }, { x: after, y: lane }, { x: after, y: s.b.y }, s.b]
      : [s.a, { x: s.a.x, y: before }, { x: lane, y: before }, { x: lane, y: after }, { x: s.b.x, y: after }, s.b];
    const parts = points.slice(1).map((b, i) => ({ ...s, a: points[i], b }));
    // The untouched first/last legs may already enter their own pin's bounds.
    if (parts.slice(1, -1).some(p => [...texts, ...cells].some(b => intersects(p, b)))) continue;
    if (parts.slice(1, -1).some(p => original.some(other => {
      if (other.net === s.net || horizontal(p) !== horizontal(other)) return false;
      const h = horizontal(p);
      return Math.abs((h ? p.a.y : p.a.x) - (h ? other.a.y : other.a.x)) < 3 &&
        Math.min(h ? Math.max(p.a.x, p.b.x) : Math.max(p.a.y, p.b.y), h ? Math.max(other.a.x, other.b.x) : Math.max(other.a.y, other.b.y)) >
        Math.max(h ? Math.min(p.a.x, p.b.x) : Math.min(p.a.y, p.b.y), h ? Math.min(other.a.x, other.b.x) : Math.min(other.a.y, other.b.y));
    }))) continue;
    return parts;
  }
  return [s];
}

export function postProcessSvgWires(svg: string): string {
  const { texts, cells, labels } = bounds(svg);
  const segments: Segment[] = [];
  const line = /<line\b([^>]*?)\/?\s*>/g;
  const original: Segment[] = [...svg.matchAll(line)].flatMap(m => {
    const a = attrs(m[1]), net = netOf(a);
    return net ? [{ attrs: a, net, a: { x: Number(a.x1), y: Number(a.y1) }, b: { x: Number(a.x2), y: Number(a.y2) } }] : [];
  });
  const junctionPoints = [...svg.matchAll(/<circle\b([^>]*)\/?\s*>/g)].map(m => attrs(m[1])).filter(a => netOf(a));
  // Work with line elements until all detours are known, then draw jumps.
  svg = svg.replace(line, (full, source: string) => {
    const a = attrs(source), net = netOf(a);
    if (!net) return full;
    const s: Segment = { attrs: a, net, a: { x: Number(a.x1), y: Number(a.y1) }, b: { x: Number(a.x2), y: Number(a.y2) } };
    if (![s.a.x, s.a.y, s.b.x, s.b.y].every(Number.isFinite) || (!horizontal(s) && Math.abs(s.a.x - s.b.x) > EPS)) return full;
    // Never move a branch off its junction: split at all same-net anchors first.
    const on = (p: Point) => (horizontal(s) ? Math.abs(p.y - s.a.y) < EPS : Math.abs(p.x - s.a.x) < EPS) &&
      p.x >= Math.min(s.a.x, s.b.x) && p.x <= Math.max(s.a.x, s.b.x) && p.y >= Math.min(s.a.y, s.b.y) && p.y <= Math.max(s.a.y, s.b.y);
    const points = [s.a, s.b, ...original.filter(w => w.net === net).flatMap(w => [w.a, w.b]),
      ...junctionPoints.filter(p => netOf(p) === net).map(p => ({ x: Number(p.cx), y: Number(p.cy) }))].filter(on);
    const axis = (p: Point) => horizontal(s) ? p.x : p.y;
    const unique = [...new Map(points.map(p => [axis(p), p])).values()].sort((a, b) => axis(a) - axis(b));
    const parts = unique.slice(1).flatMap((b, i) => clearText({ ...s, a: unique[i], b }, texts, cells, original));
    const index = segments.length; segments.push(...parts);
    return `<!--rtl-wire:${index}:${parts.length}-->`;
  });
  const vertical = segments.filter(s => !horizontal(s));
  const jumps: string[] = [];
  const jumpClearances: string[] = [];
  const renderLine = (s: Segment) => `<line ${serialize({ ...s.attrs, x1: String(s.a.x), y1: String(s.a.y), x2: String(s.b.x), y2: String(s.b.y) })}/>`;
  const dots = [...svg.matchAll(/<circle\b([^>]*)\/?\s*>/g)].map(m => attrs(m[1])).filter(a => netOf(a));
  const rendered = segments.map(s => {
    if (!horizontal(s)) return renderLine(s);
    const min = Math.min(s.a.x, s.b.x), max = Math.max(s.a.x, s.b.x), y = s.a.y;
    const crossings = [...new Set(vertical.filter(v => v.net !== s.net && v.a.x > min + 3 && v.a.x < max - 3 &&
      y > Math.min(v.a.y, v.b.y) + 1 && y < Math.max(v.a.y, v.b.y) - 1).map(v => v.a.x))].sort((a, b) => a - b);
    const accepted: { x: number; radius: number }[] = [];
    for (let i = 0; i < crossings.length; i++) {
      const x = crossings[i];
      const radius = Math.min(4, (x - min) / 2, (max - x) / 2,
        i ? (x - crossings[i - 1]) / 2 - 0.5 : 4, i + 1 < crossings.length ? (crossings[i + 1] - x) / 2 - 0.5 : 4);
      if (radius < 2 || dots.some(d => Math.hypot(Number(d.cx) - x, Number(d.cy) - y) < radius + 4) ||
        texts.some(b => contains(b, { x, y: y - radius }))) continue;
      accepted.push({ x, radius });
    }
    const pieces: string[] = []; let from = min;
    for (const [i, { x, radius }] of accepted.entries()) {
      pieces.push(renderLine({ ...s, a: { x: from, y }, b: { x: x - radius, y } }));
      const d = `M${x - radius},${y} A${radius},${radius} 0 0 1 ${x + radius},${y}`;
      const bus = s.attrs.class?.split(/\s+/).includes('bus');
      // The wide clearance extends sideways at the arc's vertical tangents.
      // Repaint short shoulders with the arc so it cannot shave the adjoining
      // straight wire. Paint all clearances before any foreground crossings.
      const shoulder = 4;
      const previous = accepted[i - 1], next = accepted[i + 1];
      const start = Math.max(min, x - radius - shoulder, previous ? previous.x + previous.radius : min);
      const end = Math.min(max, x + radius + shoulder, next ? next.x - next.radius : max);
      const foreground = `M${start},${y} L${x - radius},${y} A${radius},${radius} 0 0 1 ${x + radius},${y} L${end},${y}`;
      jumpClearances.push(`<path d="${d}" class="wire-jump-clearance" style="fill:none;stroke:var(--rtl-background,#1e1e1e);stroke-width:${bus ? 6.5 : 5}px"/>`);
      jumps.push(`<path ${serialize({ class: `${s.attrs.class} wire-jump`, d: foreground })}/>`);
      from = x + radius;
    }
    pieces.push(renderLine({ ...s, a: { x: from, y }, b: { x: max, y } }));
    return pieces.join('\n');
  });
  svg = svg.replace(/<!--rtl-wire:(\d+):(\d+)-->/g, (_, start, count) => rendered.slice(+start, +start + +count).join('\n'));
  // Draw crossing arcs above every wire, and connected junctions above the arcs.
  const junctions: string[] = [];
  svg = svg.replace(/<circle\b([^>]*)\/?\s*>/g, (full, source: string) => {
    const a = attrs(source);
    if (!netOf(a)) return full;
    junctions.push(`<circle ${serialize({ ...a, r: '3.5', class: `${a.class} wire-junction` })}/>`);
    return '';
  });
  const style = `.rtl-schematic path.wire-jump { fill:none; stroke:var(--rtl-wire,#d4d4d4); stroke-width:1px; stroke-linecap:round; stroke-linejoin:round; }
.rtl-schematic path.wire-jump.bus { stroke:var(--rtl-bus,#79c0ff); stroke-width:2.5px; }
.rtl-schematic circle.wire-junction { fill:#000 !important; stroke:var(--rtl-wire,#d4d4d4); stroke-width:1px; }
.rtl-schematic circle.wire-junction.bus { stroke:var(--rtl-bus,#79c0ff); }
.rtl-schematic text.wire-label-clearance { paint-order:stroke fill; stroke:var(--rtl-background,#1e1e1e); stroke-width:4px; stroke-linejoin:round; }`;
  svg = svg.includes('</style>') ? svg.replace('</style>', `${style}</style>`) : svg.replace(/(<svg\b[^>]*>)/, `$1<style>${style}</style>`);
  // If a junction or crowded symbol prevents a safe detour, redraw the label
  // with canvas clearance above the wire. Do not disconnect that junction.
  const protectedLabels = labels.filter(l => segments.some(s => intersects(s, l.box))).map(l => {
    const a = attrs(l.source.slice(0, l.source.indexOf('>')));
    delete a.id;
    const content = l.source.slice(l.source.indexOf('>') + 1, l.source.lastIndexOf('<'));
    const copy = `<text ${serialize({ ...a, x: String(l.x), y: String(l.y), class: `${a.class || ''} wire-label-clearance` })}>${content}</text>`;
    return l.selector ? `<g class="rtl-selector">${copy}</g>` : copy;
  });
  return svg.replace('</svg>', `<g class="wire-crossings">${jumpClearances.join('\n')}${jumps.join('\n')}</g><g class="wire-junctions">${junctions.join('\n')}</g><g class="wire-labels">${protectedLabels.join('\n')}</g></svg>`);
}
