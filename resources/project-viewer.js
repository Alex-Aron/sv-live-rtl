/* Uses the shared viewer's theme controls, vscode API, canvas and status badge. */
/** Route each boundary connection in its own pair of vertical lanes. Separate
 * outer/inner lane banks keep horizontal entry and exit runs from sharing a
 * segment when an inner port happens to align with another boundary anchor.
 * Only these local bridges change; parent SVG geometry stays fixed.
 */
function routeModuleBridgesDetour(connections, width, height, gutter, laneSpacing = 16, labelClearance = 0) {
  const routed = [];
  for (const input of [true, false]) {
    const side = connections.filter(c => c.input === input);
    if (!side.length) continue;
    const usable = Math.min(gutter, ...side.map(c => input ? c.x : width - c.x));
    const start = Math.min(labelClearance + 24, usable - 32);
    const pitch = Math.min(laneSpacing, (usable - start - 24) / (2 * side.length + 1));
    const occupiedRows = side.flatMap(c => [c.fromY, c.y]);
    const mirror = x => input ? x : width - x;
    side.forEach((connection, index) => {
      const outer = start + (index + 1) * pitch;
      const inner = start + (side.length + index + 2) * pitch;
      const ideal = (connection.fromY + connection.y) / 2;
      const candidates = [ideal];
      for (let y = 12; y < height - 12; y += 4) candidates.push(y);
      const clearance = y => Math.min(...occupiedRows.map(row => Math.abs(row - y)));
      const safe = candidates.filter(y => y >= 12 && y <= height - 12 && clearance(y) >= 6);
      safe.sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal));
      // With very dense interfaces, choose the clearest remaining row rather
      // than silently placing a second wire on an occupied segment.
      const row = safe[0] ?? candidates.sort((a, b) => clearance(b) - clearance(a))[0];
      occupiedRows.push(row);
      const points = Math.abs(connection.fromY - connection.y) < 0.001
        ? [[mirror(0), connection.fromY], [connection.x, connection.y]]
        : [[mirror(0), connection.fromY], [mirror(outer), connection.fromY],
          [mirror(outer), row], [mirror(inner), row], [mirror(inner), connection.y],
          [connection.x, connection.y]];
      routed.push({ ...connection, points, d: points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ') });
    });
  }
  return routed;
}

/** Prefer straight connections or one vertical leg. Use the separated-lane
 * detour only when unavoidable alignment conflicts would merge wire segments. */
function routeModuleBridges(connections, width, height, gutter, laneSpacing = 16, labelClearance = 0) {
  const result = [];
  for (const input of [true, false]) {
    const side = connections.filter(c => c.input === input);
    const before = side.map(() => new Set());
    // A boundary entry near another port's exit must turn before that exit.
    for (let i = 0; i < side.length; i++) for (let j = 0; j < side.length; j++) {
      if (i !== j && Math.abs(side[i].fromY - side[j].y) < 3) before[j].add(i);
    }
    const order = [], pending = new Set(side.map((_, i) => i));
    while (pending.size) {
      const next = [...pending].find(i => [...before[i]].every(j => !pending.has(j)));
      if (next === undefined) break;
      order.push(next); pending.delete(next);
    }
    const usable = Math.min(gutter, ...side.map(c => input ? c.x : width - c.x));
    const routes = side.map((c, i) => {
      const start = Math.min(labelClearance + 20, usable - 32);
      const pitch = Math.min(laneSpacing, (usable - start - 16) / (side.length + 1));
      const lane = start + (order.indexOf(i) + 1) * pitch;
      const x = input ? lane : width - lane;
      const points = Math.abs(c.fromY - c.y) < 0.001
        ? [[input ? 0 : width, c.fromY], [c.x, c.y]]
        : [[input ? 0 : width, c.fromY], [x, c.fromY], [x, c.y], [c.x, c.y]];
      return { ...c, points, d: points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ') };
    });
    let conflict = pending.size > 0;
    for (let i = 0; !conflict && i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i].points, b = routes[j].points;
      for (let u = 1; u < a.length; u++) for (let v = 1; v < b.length; v++) {
        const ah = a[u][1] === a[u - 1][1], bh = b[v][1] === b[v - 1][1];
        if (ah !== bh) continue;
        const axis = ah ? 0 : 1, fixed = ah ? 1 : 0;
        const overlap = Math.min(Math.max(a[u][axis], a[u-1][axis]), Math.max(b[v][axis], b[v-1][axis])) -
          Math.max(Math.min(a[u][axis], a[u-1][axis]), Math.min(b[v][axis], b[v-1][axis]));
        if (overlap > 0.01 && Math.abs(a[u][fixed] - b[v][fixed]) < 3) conflict = true;
      }
    }
    result.push(...(conflict ? routeModuleBridgesDetour(side, width, height, gutter, laneSpacing, labelClearance) : routes));
  }
  return result;
}


/** Give unconnected bridge crossings the same raised arc as rendered ELK
 * wires. Keep route.points untouched: they describe the electrical route and
 * remain useful for overlap checks. Only the presentation path has gaps. */
function decorateModuleBridgeCrossings(routes) {
  const segments = routes.flatMap((route, index) => route.points.slice(1).map((b, i) => ({
    a: route.points[i], b, index
  })));
  const vertical = segments.filter(s => s.a[0] === s.b[0] && s.a[1] !== s.b[1]);
  const endpoints = routes.flatMap(r => [r.points[0], r.points[r.points.length - 1]]);
  const jumps = [];
  const decorated = routes.map((route, index) => {
    const parts = [];
    for (const s of segments.filter(s => s.index === index)) {
      const [ax, ay] = s.a, [bx, by] = s.b;
      if (ay !== by) { parts.push(`M${ax},${ay} L${bx},${by}`); continue; }
      const low = Math.min(ax, bx), high = Math.max(ax, bx);
      const crossings = [...new Set(vertical.filter(v => v.index !== index &&
        v.a[0] > low + 5 && v.a[0] < high - 5 &&
        ay > Math.min(v.a[1], v.b[1]) + 5 && ay < Math.max(v.a[1], v.b[1]) - 5
      ).map(v => v.a[0]))].sort((a, b) => a - b);
      const accepted = crossings.flatMap((x, i) => {
        const radius = Math.min(4,
          i ? (x - crossings[i - 1]) / 2 - 0.5 : 4,
          i + 1 < crossings.length ? (crossings[i + 1] - x) / 2 - 0.5 : 4);
        return radius < 2 || endpoints.some(p => Math.hypot(p[0] - x, p[1] - ay) < radius + 4)
          ? [] : [{ x, radius }];
      });
      let from = low;
      accepted.forEach(({ x, radius }, i) => {
        parts.push(`M${from},${ay} L${x - radius},${ay}`);
        // Repaint the clearance at each join without drawing a straight
        // shoulder through the neighboring arc when crossings are close.
        const left = Math.max(x - radius - 4, i ? accepted[i - 1].x + accepted[i - 1].radius : low);
        const right = Math.min(x + radius + 4, i + 1 < accepted.length ? accepted[i + 1].x - accepted[i + 1].radius : high);
        jumps.push({ ...route,
          clearanceD: `M${x - radius},${ay} A${radius},${radius} 0 0 1 ${x + radius},${ay}`,
          d: `M${left},${ay} L${x - radius},${ay} A${radius},${radius} 0 0 1 ${x + radius},${ay} L${right},${ay}` });
        from = x + radius;
      });
      parts.push(`M${from},${ay} L${high},${ay}`);
    }
    return { ...route, d: parts.join(' ') };
  });
  return { routes: decorated, jumps };
}

(() => {
  const ns = 'http://www.w3.org/2000/svg';
  const modules = new Map();
  const mounts = new Set();
  const saved = vscode.getState() || {};
  const expanded = new Set(saved.expanded || []);
  const moduleSelect = document.getElementById('project-module');
  const error = document.getElementById('project-error');
  const info = document.getElementById('project-info');
  const auto = document.getElementById('project-auto');
  let top, selected, root, serial = 0;
  let rootCollapsed = saved.rootCollapsed || false;
  auto.checked = saved.auto || false;
  function persist() {
    vscode.setState({ ...(vscode.getState() || {}), expanded: [...expanded], auto: auto.checked, rootCollapsed, selected });
  }
  function svgEl(tag, attrs = {}, text) {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function forget(mount) {
    for (const child of [...mount.children]) forget(child);
    mounts.delete(mount);
    mount.parent?.children.delete(mount);
  }
  function scopedSvg(source) {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('Could not display a module SVG.');
    const svg = document.importNode(doc.documentElement, true);
    // Repeated module instances must not duplicate document IDs.
    const prefix = 'project-' + (++serial) + '-';
    const ids = new Map();
    svg.querySelectorAll('[id]').forEach(el => {
      const id = el.getAttribute('id');
      el.dataset.originalId = id;
      ids.set(id, prefix + id);
      el.id = prefix + id;
    });
    svg.querySelectorAll('*').forEach(el => {
      for (const attr of [...el.attributes]) {
        if (attr.value.startsWith('#') && ids.has(attr.value.slice(1))) el.setAttribute(attr.name, '#' + ids.get(attr.value.slice(1)));
        else if (attr.value.includes('url(#')) el.setAttribute(attr.name, attr.value.replace(/url\(#([^)]*)\)/g, (full, id) => ids.has(id) ? 'url(#' + ids.get(id) + ')' : full));
      }
    });
    return svg;
  }
  function mountModule(host, key, instancePath, parent) {
    const mount = { host, key, path: instancePath, parent, children: new Set(), svg: undefined };
    mounts.add(mount);
    parent?.children.add(mount);
    replaceModule(mount);
    return mount;
  }
  function replaceModule(mount) {
    for (const child of [...mount.children]) forget(child);
    const model = modules.get(mount.key);
    if (!model) return;
    const svg = scopedSvg(model.svg);
    svg.dataset.instancePath = mount.path;
    mount.host.replaceChildren(svg);
    mount.svg = svg;
    // Only instance groups belonging to this module (nested modules are added later).
    const instances = [...svg.querySelectorAll('.rtl-module-instance')];
    for (const group of instances) {
      const key = group.dataset.module;
      const child = modules.get(key);
      if (!child) continue;
      const name = (group.dataset.originalId || '').replace(/^cell_/, '');
      const instancePath = mount.path + '/' + encodeURIComponent(name);
      drawFrame(group, child, name, instancePath, mount);
    }
    colorGenericCells();
  }
  function drawFrame(group, model, name, instancePath, parent) {
    // A frame is fixed in the parent layout. Replacing its contents cannot move
    // parent wires or siblings. Reflow explicitly allocates new frame sizes.
    const originalTransform = group.getAttribute('transform');
    const w = Number(group.getAttribute('s:width')), h = Number(group.getAttribute('s:height'));
    const open = expanded.has(instancePath) && !model.blackbox;
    for (const child of [...parent.children]) if (child.path === instancePath) forget(child);
    group.replaceChildren();
    group.setAttribute('transform', originalTransform);
    const boxW = open ? w : Math.min(240, w - 40);
    const inputPorts = model.ports.filter(p => p.direction === 'input');
    const outputPorts = model.ports.filter(p => p.direction !== 'input');
    const boxH = open ? h : Math.min(h - 20, Math.max(inputPorts.length, outputPorts.length) * 24 + 76);
    const bx = (w - boxW) / 2, by = open ? 0 : (h - boxH) / 2;
    group.append(svgEl('rect', { x: bx, y: by, width: boxW, height: boxH, rx: 4, class: open ? 'project-boundary' : 'project-collapsed' }));
    group.append(svgEl('text', { x: w / 2, y: by + 22, 'text-anchor': 'middle', class: 'project-instance' }, name));
    group.append(svgEl('text', { x: w / 2, y: by + 41, 'text-anchor': 'middle', class: 'project-module-name' }, model.name));
    const gutter = model.gutter || 120;
    const connections = [];
    for (const port of model.ports) group.append(svgEl('g', { 's:x': port.direction === 'input' ? 0 : w, 's:y': port.y, 's:pid': port.name }));
    let nested;
    if (open) {
      const content = svgEl('g');
      group.append(content);
      nested = mountModule(content, model.key, instancePath, parent);
      const innerW = w - 2 * gutter, innerH = h - 90;
      nested.svg.setAttribute('x', String(gutter)); nested.svg.setAttribute('y', '60');
      nested.svg.setAttribute('width', String(innerW)); nested.svg.setAttribute('height', String(innerH));
      const vb = nested.svg.getAttribute('viewBox')?.split(/[ ,]+/).map(Number) || [0, 0, innerW, innerH];
      const scale = Math.min(innerW / vb[2], innerH / vb[3]);
      const dx = gutter + (innerW - vb[2] * scale) / 2 - vb[0] * scale;
      const dy = 60 + (innerH - vb[3] * scale) / 2 - vb[1] * scale;
      // Connect the stable boundary anchors to the inner schematic's I/O glyphs.
      for (const port of model.ports) {
        const cell = [...nested.svg.children].find(el => el.dataset?.originalId === 'cell_' + port.label);
        const t = cell?.getAttribute('transform')?.match(/translate\(([^,]+),([^)]*)\)/);
        if (!t) continue;
        const input = port.direction === 'input';
        const x = dx + (+t[1] + (input ? 0 : 30)) * scale;
        const pin = [...cell.children].find(el => el.getAttribute('s:pid') === (input ? 'Y' : 'A'));
        const pinY = Number(pin?.getAttribute('s:y') || 10);
        const y = dy + (+t[2] + pinY) * scale;
        connections.push({ name: port.name, width: port.width, input, fromY: port.y, x, y });
      }
    } else {
      for (const [ports, input] of [[inputPorts, true], [outputPorts, false]]) ports.forEach((port, i) => {
        const y = by + 60 + i * 24;
        connections.push({ name: port.name, width: port.width, input, fromY: port.y, x: input ? bx : bx + boxW, y });
        group.append(svgEl('text', { x: input ? bx + 8 : bx + boxW - 8, y: y - 5, 'text-anchor': input ? 'start' : 'end', class: 'project-port-label' }, port.label));
      });
    }
    // Expanded boundary labels use their own column; all vertical lanes sit
    // beyond that column rather than cutting through another port label.
    const labelClearance = open ? Math.max(0, ...model.ports.map(p => p.label.length * 7.2 + 16)) : 0;
    const bridges = decorateModuleBridgeCrossings(routeModuleBridges(connections, w, h, gutter, model.wireLaneSpacing || 16, labelClearance));
    for (const route of bridges.routes) {
      group.append(svgEl('path', { d: route.d, 'data-port': route.name,
        class: 'project-bridge' + (route.width > 1 ? ' bus' : '') }));
    }
    // Paint every crossing above the other bridge paths. A canvas-colored
    // underlay gives a visible clearance beneath the raised arc.
    for (const jump of bridges.jumps) {
      group.append(svgEl('path', { d: jump.clearanceD, class: 'wire-jump-clearance',
        style: `fill:none;stroke:var(--rtl-background,#1e1e1e);stroke-width:${jump.width > 1 ? 6.5 : 5}px` }));
    }
    for (const jump of bridges.jumps) {
      group.append(svgEl('path', { d: jump.d, 'data-port': jump.name,
        class: 'project-bridge wire-jump' + (jump.width > 1 ? ' bus' : ''),
        'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    if (open) for (const port of model.ports) group.append(svgEl('text', {
      x: port.direction === 'input' ? 8 : w - 8, y: port.y - 5,
      'text-anchor': port.direction === 'input' ? 'start' : 'end', class: 'project-port-label'
    }, port.label));
    if (!model.blackbox) {
      const button = svgEl('g', { class: 'project-toggle', role: 'button', tabindex: '0',
        'aria-expanded': String(open), 'aria-label': (open ? 'Collapse ' : 'Expand ') + name });
      button.append(svgEl('rect', { x: bx + 8, y: by + 8, width: 22, height: 22, rx: 3 }));
      button.append(svgEl('text', { x: bx + 19, y: by + 25 }, open ? '−' : '+'));
      const toggle = event => {
        event.stopPropagation();
        if (expanded.has(instancePath)) expanded.delete(instancePath); else expanded.add(instancePath);
        persist();
        vscode.postMessage({ type: 'projectLayout', selected, expanded: [...expanded] });
      };
      button.addEventListener('click', toggle);
      button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(event); } });
      group.append(button);
    }
  }
  function showRoot(key, baseKey = key) {
    const first = !root;
    if (!modules.has(key)) return;
    for (const mount of [...mounts]) forget(mount);
    selected = baseKey; moduleSelect.value = baseKey;
    const frame = document.createElement('section'); frame.id = 'project-root';
    const heading = document.createElement('div'); heading.id = 'root-heading';
    const button = document.createElement('button'); button.textContent = rootCollapsed ? '+' : '−';
    const title = document.createElement('strong'); title.textContent = modules.get(key).name;
    heading.append(button, title);
    const content = document.createElement('div'); content.hidden = rootCollapsed;
    button.setAttribute('aria-expanded', String(!rootCollapsed));
    button.addEventListener('click', () => { rootCollapsed = !rootCollapsed; content.hidden = rootCollapsed; button.textContent = rootCollapsed ? '+' : '−'; button.setAttribute('aria-expanded', String(!rootCollapsed)); persist(); });
    frame.append(heading, content); canvas.replaceChildren(frame);
    root = mountModule(content, key, baseKey, undefined);
    viewport?.setContent(frame, { fit: !first || !saved.viewport });
    persist();
  }
  document.getElementById('project-refresh').addEventListener('click', () => vscode.postMessage({ type: 'projectRefresh' }));
  document.getElementById('project-reflow').addEventListener('click', () => vscode.postMessage({ type: 'projectRefresh', reflow: true }));
  moduleSelect.addEventListener('change', () => {
    selected = moduleSelect.value; persist();
    vscode.postMessage({ type: 'projectLayout', selected, expanded: [...expanded] });
  });
  auto.addEventListener('change', () => { persist(); vscode.postMessage({ type: 'projectAuto', enabled: auto.checked }); });
  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'projectStatus') {
      badge.className = 'badge ' + (msg.error ? 'err' : 'stale');
      badge.textContent = msg.error ? 'Stale — showing last valid project' : (msg.layout ? 'Updating layout…' : 'Updating project…');
      error.textContent = msg.error || '';
    } else if (msg.type === 'projectSnapshot') {
      try {
        const position = viewport?.capture();
        const previousRoot = root;
        top = msg.top;
        const changed = new Set(msg.modules.map(m => m.key));
        for (const model of msg.modules) modules.set(model.key, model);
        for (const key of [...modules.keys()]) if (!(msg.sceneKeys || msg.keys).includes(key)) modules.delete(key);
        moduleSelect.replaceChildren(...msg.keys.map(key => { const option = document.createElement('option'); option.value = key; option.textContent = modules.get(key).name + (key === top ? ' (top)' : '') + (key.startsWith('$paramod') ? ' · ' + key.slice(-8) : ''); return option; }));
        if (msg.viewRoot && (!root || root.key !== msg.viewRoot || msg.reflow)) showRoot(msg.viewRoot, msg.selected);
        else if (!msg.viewRoot && (!root || !modules.has(selected) || msg.reflow)) showRoot(modules.has(selected || saved.selected) ? (selected || saved.selected) : top);
        else {
          moduleSelect.value = selected;
          // Patch only mounts of changed modules. If an ancestor is patched it
          // recreates its descendants, so skip their detached old mounts.
          for (const mount of [...mounts]) {
            if (!mounts.has(mount) || !changed.has(mount.key)) continue;
            if (mount.parent && changed.has(mount.parent.key)) continue;
            if (mount === root) replaceModule(mount);
            else {
              const parent = mount.parent, group = mount.host.parentNode;
              const name = decodeURIComponent(mount.path.slice(mount.path.lastIndexOf('/') + 1));
              drawFrame(group, modules.get(mount.key), name, mount.path, parent);
            }
          }
        }
        if (root && root === previousRoot && !msg.reflow && position) viewport?.restore(position);
        badge.className = 'badge ok'; badge.textContent = 'Project snapshot'; error.textContent = '';
        info.textContent = `${msg.keys.length} modules · ${msg.stats.synthesized.length} synthesized · ${msg.stats.rendered.length} layouts updated · ${msg.stats.reused} reused. Expand with +; Reflow resizes module frames.`;
      } catch (e) { error.textContent = e.message; badge.className = 'badge err'; badge.textContent = 'Display error'; }
    }
  });
  vscode.postMessage({ type: 'projectReady', auto: auto.checked, expanded: [...expanded], selected: saved.selected });
})();
