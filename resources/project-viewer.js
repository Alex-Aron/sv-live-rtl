/* Uses the shared viewer's theme controls, vscode API, canvas and status badge. */
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
    let nested;
    if (open) {
      const content = svgEl('g');
      group.append(content);
      nested = mountModule(content, model.key, instancePath, parent);
      const innerW = w - 240, innerH = h - 90;
      nested.svg.setAttribute('x', '120'); nested.svg.setAttribute('y', '60');
      nested.svg.setAttribute('width', String(innerW)); nested.svg.setAttribute('height', String(innerH));
      const vb = nested.svg.getAttribute('viewBox')?.split(/[ ,]+/).map(Number) || [0, 0, innerW, innerH];
      const scale = Math.min(innerW / vb[2], innerH / vb[3]);
      const dx = 120 + (innerW - vb[2] * scale) / 2 - vb[0] * scale;
      const dy = 60 + (innerH - vb[3] * scale) / 2 - vb[1] * scale;
      // Connect the stable boundary anchors to the inner schematic's I/O glyphs.
      for (const port of model.ports) {
        const cell = [...nested.svg.children].find(el => el.dataset?.originalId === 'cell_' + port.label);
        const t = cell?.getAttribute('transform')?.match(/translate\(([^,]+),([^)]*)\)/);
        if (!t) continue;
        const input = port.direction === 'input';
        const x = dx + (+t[1] + (input ? 0 : 30)) * scale;
        const y = dy + (+t[2] + 10) * scale;
        const start = input ? 0 : w, bend = input ? 100 : w - 100;
        group.append(svgEl('path', { d: `M${start},${port.y} H${bend} V${y} H${x}`, class: 'project-bridge' + (port.width > 1 ? ' bus' : '') }));
      }
    } else {
      for (const [ports, input] of [[inputPorts, true], [outputPorts, false]]) ports.forEach((port, i) => {
        const y = by + 60 + i * 24;
        const start = input ? 0 : w, end = input ? bx : bx + boxW;
        const elbow = input ? bx - 12 : bx + boxW + 12;
        group.append(svgEl('path', { d: `M${start},${port.y} H${elbow} V${y} H${end}`, class: 'project-bridge' + (port.width > 1 ? ' bus' : '') }));
        group.append(svgEl('text', { x: input ? bx + 8 : bx + boxW - 8, y: y - 5, 'text-anchor': input ? 'start' : 'end', class: 'project-port-label' }, port.label));
      });
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
        persist(); drawFrame(group, modules.get(model.key), name, instancePath, parent);
      };
      button.addEventListener('click', toggle);
      button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(event); } });
      group.append(button);
    }
  }
  function showRoot(key) {
    const first = !root;
    if (!modules.has(key)) return;
    for (const mount of [...mounts]) forget(mount);
    selected = key; moduleSelect.value = key;
    const frame = document.createElement('section'); frame.id = 'project-root';
    const heading = document.createElement('div'); heading.id = 'root-heading';
    const button = document.createElement('button'); button.textContent = rootCollapsed ? '+' : '−';
    const title = document.createElement('strong'); title.textContent = modules.get(key).name;
    heading.append(button, title);
    const content = document.createElement('div'); content.hidden = rootCollapsed;
    button.setAttribute('aria-expanded', String(!rootCollapsed));
    button.addEventListener('click', () => { rootCollapsed = !rootCollapsed; content.hidden = rootCollapsed; button.textContent = rootCollapsed ? '+' : '−'; button.setAttribute('aria-expanded', String(!rootCollapsed)); persist(); });
    frame.append(heading, content); canvas.replaceChildren(frame);
    root = mountModule(content, key, key, undefined);
    viewport?.setContent(frame, { fit: !first || !saved.viewport });
    persist();
  }
  document.getElementById('project-refresh').addEventListener('click', () => vscode.postMessage({ type: 'projectRefresh' }));
  document.getElementById('project-reflow').addEventListener('click', () => vscode.postMessage({ type: 'projectRefresh', reflow: true }));
  moduleSelect.addEventListener('change', () => showRoot(moduleSelect.value));
  auto.addEventListener('change', () => { persist(); vscode.postMessage({ type: 'projectAuto', enabled: auto.checked }); });
  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'projectStatus') {
      badge.className = 'badge ' + (msg.error ? 'err' : 'stale');
      badge.textContent = msg.error ? 'Stale — showing last valid project' : 'Updating project…';
      error.textContent = msg.error || '';
    } else if (msg.type === 'projectSnapshot') {
      try {
        const position = viewport?.capture();
        const previousRoot = root;
        top = msg.top;
        const changed = new Set(msg.modules.map(m => m.key));
        for (const model of msg.modules) modules.set(model.key, model);
        for (const key of [...modules.keys()]) if (!msg.keys.includes(key)) modules.delete(key);
        moduleSelect.replaceChildren(...msg.keys.map(key => { const option = document.createElement('option'); option.value = key; option.textContent = modules.get(key).name + (key === top ? ' (top)' : '') + (key.startsWith('$paramod') ? ' · ' + key.slice(-8) : ''); return option; }));
        if (!root || !modules.has(selected) || msg.reflow) showRoot(modules.has(selected || saved.selected) ? (selected || saved.selected) : top);
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
  vscode.postMessage({ type: 'projectReady', auto: auto.checked });
})();
