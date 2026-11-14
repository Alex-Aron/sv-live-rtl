/**
 * Transforms Yosys netlist JSON:
 * Renames multi-bit port keys to include their vector ranges, e.g. `count [3:0]` or `in_a [7:4]`.
 * Preserves offset and upto semantics from Yosys port/net attributes and selects
 * the digital skin's stacked mux/register symbols for multi-bit data paths.
 */
export function transformYosysNetlist(netlist: any): any {
  if (!netlist || !netlist.modules) {
    return netlist;
  }

  const renamedPorts = new Map<string, Map<string, string>>();
  for (const [moduleName, mod] of Object.entries<any>(netlist.modules)) {
    if (!mod || !mod.ports) continue;

    const newPorts: Record<string, any> = {};
    const renames = new Map<string, string>();
    renamedPorts.set(moduleName, renames);
    for (const [portName, port] of Object.entries<any>(mod.ports)) {
      if (!port || !port.bits) {
        newPorts[portName] = port;
        continue;
      }

      // If port already has bracket notation, don't duplicate
      if (/\s\[-?\d+:-?\d+\]$/.test(portName)) {
        newPorts[portName] = port;
        continue;
      }

      const netInfo = mod.netnames?.[portName];
      const len = port.bits.length;

      const offset = port.offset !== undefined
        ? port.offset
        : (netInfo?.offset !== undefined ? netInfo.offset : undefined);

      const uptoVal = port.upto !== undefined
        ? port.upto
        : (netInfo?.upto !== undefined ? netInfo.upto : undefined);
      const isUpto = uptoVal !== undefined && Number(uptoVal) === 1;

      const isSingleBitVector = Number(netInfo?.attributes?.single_bit_vector) === 1;
      const isVector = len > 1 || isSingleBitVector || offset !== undefined;

      if (isVector) {
        const baseOffset = Number(offset ?? 0);
        let rangeStr: string;
        if (isUpto) {
          const low = baseOffset;
          const high = baseOffset + len - 1;
          rangeStr = `[${low}:${high}]`;
        } else {
          const low = baseOffset;
          const high = baseOffset + len - 1;
          rangeStr = `[${high}:${low}]`;
        }

        const newPortName = `${portName} ${rangeStr}`;
        newPorts[newPortName] = port;
        renames.set(portName, newPortName);

        // Also alias in netnames if present so lookups succeed
        if (mod.netnames && mod.netnames[portName]) {
          mod.netnames[newPortName] = mod.netnames[portName];
        }
      } else {
        newPorts[portName] = port;
      }
    }
    mod.ports = newPorts;
  }

  // Module port names are also used by instances in parent modules. Update both
  // maps so adding display ranges never disconnects a hierarchical netlist.
  for (const mod of Object.values<any>(netlist.modules)) {
    for (const cell of Object.values<any>(mod.cells || {})) {
      expandBinaryMuxPorts(cell);
      selectStackedSymbol(cell);
      const renames = renamedPorts.get(cell.type);
      if (!renames) continue;
      for (const field of ['connections', 'port_directions']) {
        if (!cell[field]) continue;
        cell[field] = Object.fromEntries(Object.entries(cell[field]).map(([name, value]) => [renames.get(name) || name, value]));
      }
    }
  }
  return netlist;
}

/** Presentation-only expansion of a Yosys binary mux's packed A port into
 * separately wired words. I0 is the least significant word, selected by S=0.
 * Preserve binary select bit order, constants, and output wiring exactly.
 */
function expandBinaryMuxPorts(cell: any): void {
  if (cell.type !== '$bmux') return;
  const { A, S, Y } = cell.connections || {};
  if (![A, S, Y].every(Array.isArray) || !Y.length || S.length < 1 || S.length > 5) return;
  if (Object.keys(cell.connections).some(port => !['A', 'S', 'Y'].includes(port))) return;
  const choices = 2 ** S.length;
  if (A.length !== choices * Y.length) return;
  if (choices === 2) {
    cell.type = '$mux';
    cell.connections = { A: A.slice(0, Y.length), B: A.slice(Y.length), S, Y };
    cell.port_directions = { A: 'input', B: 'input', S: 'input', Y: 'output' };
  } else {
    cell.type = `$binary_mux${choices}${Y.length > 1 ? '-bus' : ''}`;
    cell.connections = Object.fromEntries(Array.from({ length: choices }, (_, i) =>
      [`I${i}`, A.slice(i * Y.length, (i + 1) * Y.length)]
    ));
    Object.assign(cell.connections, { S, Y });
    cell.port_directions = Object.fromEntries(Object.keys(cell.connections).map(port =>
      [port, port === 'Y' ? 'output' : 'input']
    ));
  }
}

// netlistsvg matches aliases literally; it does not select the existing -bus
// templates from connection widths. Only change display types with an exact
// matching template and interface, preserving every connection and parameter.
const STACKED_SYMBOLS: Record<string, { output: string; ports: string[] }> = {
  $mux: { output: 'Y', ports: ['A', 'B', 'S', 'Y'] },
  $pmux: { output: 'Y', ports: ['A', 'B', 'S', 'Y'] },
  $_MUX_: { output: 'Y', ports: ['A', 'B', 'S', 'Y'] },
  $dff: { output: 'Q', ports: ['D', 'Q', 'CLK'] },
  $adff: { output: 'Q', ports: ['D', 'Q', 'CLK', 'ARST'] },
  $sdff: { output: 'Q', ports: ['D', 'Q', 'CLK', 'SRST'] },
  $dffn: { output: 'Q', ports: ['D', 'Q', 'CLK'] },
  $_DFF_: { output: 'Q', ports: ['D', 'Q', 'C'] },
  $_DFF_P_: { output: 'Q', ports: ['D', 'Q', 'C'] },
  $_DFF_N_: { output: 'Q', ports: ['D', 'Q', 'C'] }
};

function selectStackedSymbol(cell: any): void {
  const symbol = STACKED_SYMBOLS[cell.type];
  if (!symbol || !Array.isArray(cell.connections?.[symbol.output]) ||
    cell.connections[symbol.output].length <= 1) return;
  if (Object.keys(cell.connections).some(port => !symbol.ports.includes(port))) return;
  cell.type += '-bus';
}

interface Point { x: number; y: number }
interface Box { left: number; right: number; top: number; bottom: number }
interface Wire {
  a: Point; b: Point; net: string; width: number; horizontal: boolean;
}
interface Label { wire: Wire; center: Point; gap: number; box: Box }

const LINE = /<line\b([^>]*?)\/?\s*>/g;
const EPS = 0.001;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const pointKey = (p: Point) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;

function attributes(source: string): Record<string, string> {
  return Object.fromEntries([...source.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1], m[2]]));
}

function netInfo(attrs: Record<string, string>): { net: string; width: number } | undefined {
  const net = attrs.class?.split(/\s+/).find(c => /^net_[\w,]+$/.test(c));
  return net ? { net, width: net.slice(4).split(',').length } : undefined;
}

function wireFrom(attrs: Record<string, string>): Wire | undefined {
  const info = netInfo(attrs);
  if (!info) return;
  const a = { x: Number(attrs.x1), y: Number(attrs.y1) };
  const b = { x: Number(attrs.x2), y: Number(attrs.y2) };
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite) || distance(a, b) < EPS) return;
  if (!near(a.x, b.x) && !near(a.y, b.y)) return; // netlistsvg routes orthogonally
  return { a, b, ...info, horizontal: near(a.y, b.y) };
}

function onWire(p: Point, w: Wire): boolean {
  return (w.horizontal ? near(p.y, w.a.y) : near(p.x, w.a.x)) &&
    p.x >= Math.min(w.a.x, w.b.x) - EPS && p.x <= Math.max(w.a.x, w.b.x) + EPS &&
    p.y >= Math.min(w.a.y, w.b.y) - EPS && p.y <= Math.max(w.a.y, w.b.y) + EPS;
}

/** Read symbol and text bounds from the translate-only SVG emitted by netlistsvg.
 * Text uses a conservative bound for the skin's fixed 10px monospace font.
 * Actual rect heights cover dynamically expanded generic and split/join symbols.
 */
function obstacles(svg: string): Box[] {
  const result: Box[] = [];
  const stack: Point[] = [{ x: 0, y: 0 }];
  const tokens = /<g\b[^>]*>|<\/g\s*>|<rect\b[^>]*>|<text\b[^>]*>[\s\S]*?<\/text>/g;
  for (const match of svg.matchAll(tokens)) {
    const token = match[0];
    if (token.startsWith('</g')) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = attributes(token.slice(0, token.indexOf('>')));
    const parent = stack[stack.length - 1];
    if (token.startsWith('<g')) {
      const translate = attrs.transform?.match(/translate\(\s*([-\d.e+]+)[,\s]+([-\d.e+]+)\s*\)/i);
      const origin = { x: parent.x + Number(translate?.[1] || 0), y: parent.y + Number(translate?.[2] || 0) };
      if (attrs['s:type']) result.push({ left: origin.x - 4, right: origin.x + Number(attrs['s:width']) + 4,
        top: origin.y - 4, bottom: origin.y + Number(attrs['s:height']) + 4 });
      if (!token.endsWith('/>')) stack.push(origin);
    } else if (token.startsWith('<rect')) {
      const x = parent.x + Number(attrs.x || 0), y = parent.y + Number(attrs.y || 0);
      result.push({ left: x - 3, right: x + Number(attrs.width) + 3, top: y - 3, bottom: y + Number(attrs.height) + 3 });
    } else {
      const text = token.slice(token.indexOf('>') + 1, token.lastIndexOf('<')).replace(/&[^;]+;/g, '_');
      if (!text) continue;
      const x = parent.x + Number(attrs.x || 0), y = parent.y + Number(attrs.y || 0);
      const width = text.length * 6.5;
      const anchor = attrs['text-anchor'] || (attrs.class?.includes('nodelabel') ? 'middle' : attrs.class?.includes('inputPortLabel') ? 'end' : 'start');
      const left = x - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0);
      result.push({ left: left - 3, right: left + width + 3, top: y - 12, bottom: y + 4 });
    }
  }
  return result;
}

/** Split shared/duplicate segments at branch endpoints, then trace continuous
 * routes between terminals and junctions. Bends remain part of the same route.
 */
function routes(wires: Wire[]): Wire[][] {
  const endpoints = wires.flatMap(w => [w.a, w.b]);
  const edges = new Map<string, Wire>();
  for (const w of wires) {
    const points = endpoints.filter(p => onWire(p, w)).sort((a, b) => w.horizontal ? a.x - b.x : a.y - b.y);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (distance(a, b) > EPS) edges.set(`${pointKey(a)}:${pointKey(b)}`, { ...w, a, b });
    }
  }
  const adjacency = new Map<string, Wire[]>();
  for (const w of edges.values()) for (const p of [w.a, w.b]) {
    const key = pointKey(p);
    adjacency.set(key, [...(adjacency.get(key) || []), w]);
  }
  const visited = new Set<Wire>();
  const result: Wire[][] = [];
  function trace(first: Wire, start: Point) {
    if (visited.has(first)) return;
    const route: Wire[] = [];
    let edge: Wire | undefined = first, p = start;
    while (edge && !visited.has(edge)) {
      visited.add(edge);
      const next: Point = pointKey(p) === pointKey(edge.a) ? edge.b : edge.a;
      route.push({ ...edge, a: p, b: next });
      p = next;
      const neighbors: Wire[] = adjacency.get(pointKey(p))!;
      edge = neighbors.length === 2 ? neighbors.find(w => !visited.has(w)) : undefined;
    }
    const merged: Wire[] = [];
    for (const w of route) {
      const previous = merged[merged.length - 1];
      if (previous && previous.horizontal === w.horizontal) previous.b = w.b;
      else merged.push({ ...w });
    }
    result.push(merged);
  }
  for (const w of edges.values()) {
    if (adjacency.get(pointKey(w.a))!.length !== 2) trace(w, w.a);
    else if (adjacency.get(pointKey(w.b))!.length !== 2) trace(w, w.b);
  }
  for (const w of edges.values()) if (!visited.has(w)) trace(w, w.a); // loops
  return result;
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// Space between each wire end and the inline /N/ label, in SVG units.
const BUS_LABEL_HORIZONTAL_PADDING = 1;

function placeLabel(route: Wire[], allWires: Wire[], occupied: Box[]): Label | undefined {
  const total = route.reduce((n, w) => n + distance(w.a, w.b), 0);
  const textWidth = (`/${route[0].width}/`).length * 6.5;
  const candidates: { label: Label; score: number }[] = [];
  let traveled = 0;
  for (const w of route) {
    const length = distance(w.a, w.b);
    const gap = w.horizontal ? textWidth + 2 * BUS_LABEL_HORIZONTAL_PADDING : 15;
    const margin = gap / 2 + 8;
    if (length >= margin * 2) {
      // Start at the route midpoint; try nearby clear positions on that segment.
      const ideal = Math.max(margin, Math.min(length - margin, total / 2 - traveled));
      const positions = [ideal, length / 2];
      for (let delta = 8; delta < length; delta += 8) positions.push(ideal - delta, ideal + delta);
      for (const pos of positions.filter(p => p >= margin && p <= length - margin)) {
        const center = { x: w.a.x + (w.b.x - w.a.x) * pos / length, y: w.a.y + (w.b.y - w.a.y) * pos / length };
        const box = { left: center.x - textWidth / 2 - 3, right: center.x + textWidth / 2 + 3, top: center.y - 8, bottom: center.y + 8 };
        if (occupied.some(b => overlaps(box, b))) continue;
        if (allWires.some(other => {
          // Collinear pieces of this net will all receive the same physical gap.
          if (other.net === w.net && other.horizontal === w.horizontal &&
            (w.horizontal ? near(other.a.y, w.a.y) : near(other.a.x, w.a.x))) return false;
          return overlaps(box, { left: Math.min(other.a.x, other.b.x) - 2, right: Math.max(other.a.x, other.b.x) + 2,
            top: Math.min(other.a.y, other.b.y) - 2, bottom: Math.max(other.a.y, other.b.y) + 2 });
        })) continue;
        candidates.push({ label: { wire: w, center, gap, box }, score: Math.abs(traveled + pos - total / 2) + (w.horizontal ? 0 : 12) });
      }
    }
    traveled += length;
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.label;
}

/** netlistsvg uses low:high slice keys internally. Format only the displayed
 * split/join labels as high:low; leave port identifiers and wiring untouched.
 */
function formatSelectorRanges(svg: string): string {
  const selectors: boolean[] = [];
  return svg.replace(/<g\b[^>]*>|<\/g\s*>|<text\b[^>]*>[\s\S]*?<\/text>/g, token => {
    if (token.startsWith('</g')) {
      selectors.pop();
    } else if (token.startsWith('<g')) {
      const type = attributes(token)['s:type'];
      const inSelector = type === 'split' || type === 'join' || selectors[selectors.length - 1] === true;
      if (!token.endsWith('/>')) selectors.push(inSelector);
    } else if (selectors[selectors.length - 1]) {
      return token.replace(/>(\s*)(\d+):(\d+)(\s*)<\/text>$/, (_, before, a, b, after) =>
        `>${before}${Math.max(Number(a), Number(b))}:${Math.min(Number(a), Number(b))}${after}</text>`
      );
    }
    return token;
  });
}

/** Cut real gaps for inline /N/ labels. No diagonal ticks or background masks.
 * Labels sit near the routed connection midpoint and avoid symbols, their text,
 * other wires, branch junctions, and previously placed labels. If a route has no
 * safe room, retain its thick bus wire without forcing an overlapping label.
 */
export function postProcessSvgBuses(svg: string): string {
  svg = formatSelectorRanges(svg);
  const allWires = [...svg.matchAll(LINE)].map(m => wireFrom(attributes(m[1]))).filter((w): w is Wire => !!w);
  const occupied = obstacles(svg);
  // Junction dots must remain visible, including dots on shared collinear runs.
  for (const m of svg.matchAll(/<circle\b([^>]*)\/?\s*>/g)) {
    const a = attributes(m[1]);
    if (netInfo(a)) occupied.push({ left: Number(a.cx) - 6, right: Number(a.cx) + 6, top: Number(a.cy) - 6, bottom: Number(a.cy) + 6 });
  }
  const groups = new Map<string, Wire[]>();
  for (const w of allWires) if (w.width > 1) groups.set(w.net, [...(groups.get(w.net) || []), w]);
  const labels: Label[] = [];
  for (const group of groups.values()) for (const route of routes(group)) {
    const label = placeLabel(route, allWires, occupied);
    if (label) { labels.push(label); occupied.push(label.box); }
  }

  let updated = svg.replace(LINE, (full, source: string) => {
    const attrs = attributes(source), info = netInfo(attrs);
    if (!info) return full;
    const classes = `${attrs.class} width_${info.width}${info.width > 1 ? ' bus' : ''}`;
    const decorated = full.replace(/class="[^"]*"/, `class="${classes}"`);
    const w = wireFrom(attrs);
    if (!w) return decorated;
    const coord = (p: Point) => w.horizontal ? p.x : p.y;
    let intervals = [[Math.min(coord(w.a), coord(w.b)), Math.max(coord(w.a), coord(w.b))]];
    for (const l of labels) {
      if (l.wire.net !== w.net || l.wire.horizontal !== w.horizontal ||
        !(w.horizontal ? near(l.center.y, w.a.y) : near(l.center.x, w.a.x))) continue;
      const low = coord(l.center) - l.gap / 2, high = coord(l.center) + l.gap / 2;
      intervals = intervals.flatMap(([a, b]) => {
        if (high <= a || low >= b) return [[a, b]];
        return [...(a < low ? [[a, low]] : []), ...(b > high ? [[high, b]] : [])];
      });
    }
    if (intervals.length === 1 && near(intervals[0][1] - intervals[0][0], distance(w.a, w.b))) return decorated;
    return intervals.map(([a, b]) => {
      const lineAttrs = { ...attrs, class: classes,
        x1: w.horizontal ? a : w.a.x, y1: w.horizontal ? w.a.y : a,
        x2: w.horizontal ? b : w.a.x, y2: w.horizontal ? w.a.y : b };
      return `<line ${Object.entries(lineAttrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`;
    }).join('\n');
  });
  updated = updated.replace(/<circle\b([^>]*)\/?\s*>/g, (full, source: string) => {
    const attrs = attributes(source), info = netInfo(attrs);
    return info ? full.replace(/class="[^"]*"/, `class="${attrs.class} width_${info.width}${info.width > 1 ? ' bus' : ''}"`) : full;
  });
  const style = `
  .rtl-schematic line.bus { stroke-width: 2.5px; stroke: var(--rtl-bus, var(--rtl-wire, #d4d4d4)); }
  .rtl-schematic circle.bus { fill: var(--rtl-bus, var(--rtl-wire, #d4d4d4)) !important; }
  .rtl-schematic .bus-label { font-size: 10px; text-anchor: middle; dominant-baseline: central;
    fill: var(--rtl-bus, var(--rtl-text, #d4d4d4)); stroke: none; user-select: none; }
`;
  updated = updated.includes('</style>') ? updated.replace('</style>', `${style}</style>`) : updated.replace(/(<svg\b[^>]*>)/, `$1<style>${style}</style>`);
  if (labels.length) updated = updated.replace('</svg>', `<g class="bus-indicators">${labels.map(l =>
    `<text x="${l.center.x}" y="${l.center.y}" class="bus-label width_${l.wire.width}">/${l.wire.width}/</text>`
  ).join('\n')}</g></svg>`);
  // netlistsvg can place centered port names outside the nominal canvas.
  // Include their bounds so long data-bank labels in the gallery aren't clipped.
  updated = updated.replace(/<svg\b[^>]*>/, root => {
    const attrs = attributes(root);
    if (attrs.viewBox || !Number(attrs.width) || !Number(attrs.height)) return root;
    const left = Math.min(0, ...occupied.map(b => b.left)) - 4;
    const top = Math.min(0, ...occupied.map(b => b.top)) - 4;
    const right = Math.max(Number(attrs.width), ...occupied.map(b => b.right)) + 4;
    const bottom = Math.max(Number(attrs.height), ...occupied.map(b => b.bottom)) + 4;
    const width = right - left, height = bottom - top;
    return root.replace(/\bwidth="[^"]*"/, `width="${width}"`)
      .replace(/\bheight="[^"]*"/, `height="${height}"`)
      .replace('>', ` viewBox="${left} ${top} ${width} ${height}">`);
  });
  return updated;
}
