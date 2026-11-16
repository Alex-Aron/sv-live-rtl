import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { RTL_SYNTHESIS_PASSES } from './pipeline';
import { transformYosysNetlist, postProcessSvgBuses } from './netlistTransform';

const exec = promisify(execFile);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const quote = (value: string) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
export const escapeXml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
export interface ProjectSource { path: string; content: string }
export interface ProjectPort { name: string; label: string; direction: string; width: number; y: number }
export interface ProjectModule {
  key: string; name: string; svg: string; revision: string; width: number; height: number; gutter: number;
  baseKey?: string;
  ports: ProjectPort[]; instances: { name: string; module: string }[]; blackbox: boolean;
}
export interface ProjectDiagnostic { file: string; line: number; column: number; severity: 'Error' | 'Warning'; message: string }
export interface ProjectResult {
  ok: boolean; error?: string; diagnostics: ProjectDiagnostic[]; top: string;
  modules?: ProjectModule[]; stats?: { synthesized: string[]; rendered: string[]; reused: number };
  moduleKeys?: string[]; viewRoot?: string; selected?: string;
}
interface Cache { synthesis: string; netlist: any; render: string; module: ProjectModule }
interface IlModule { key: string; block: string; stub: string; blackbox: boolean }

/** Parse Yosys's own RTLIL serialization, not SystemVerilog source text. Nested
 * constructs are indented, so only unindented 'end' terminates a module. */
export function splitRtlil(il: string): IlModule[] {
  return [...il.matchAll(/((?:^attribute[^\n]*\n)*)^module ([^\n]+)\n([\s\S]*?)^end\s*$/gm)].map(m => {
    const id = m[2].trim();
    const ports: string[] = [];
    let attributes: string[] = [];
    for (const line of m[3].split('\n')) {
      if (/^  attribute /.test(line)) attributes.push(line);
      else {
        if (/^  (?:parameter\b|wire\b.*\b(?:input|output|inout) \d+\b)/.test(line)) ports.push(...attributes, line);
        attributes = [];
      }
    }
    return { key: id.startsWith('\\') ? id.slice(1) : id, block: m[0],
      stub: `attribute \\blackbox 1\nmodule ${id}\n${ports.join('\n')}\nend\n`,
      blackbox: /^attribute \\(?:blackbox|whitebox) 1\s*$/m.test(m[1]) };
  });
}

/** Ignore source locations and globally allocated anonymous IDs. Otherwise an
 * edit in a sibling can invalidate this module despite unchanged logic. */
export function canonicalRtlil(block: string): string {
  const types = new Set([...block.matchAll(/^  cell (\S+)/gm)].map(m => m[1]));
  const ids = new Map<string, string>();
  return block.replace(/^\s*attribute \\src .*\n/gm, '').replace(/(?<!\S)\$[^\s]+/g, token => {
    if (types.has(token) || token.startsWith('$paramod')) return token;
    if (!ids.has(token)) ids.set(token, `$anonymous${ids.size}`);
    return ids.get(token)!;
  });
}

function modulePorts(mod: any, height: number): ProjectPort[] {
  const annotated = transformYosysNetlist({ modules: { m: structuredClone(mod) } }).modules.m;
  const labels = Object.keys(annotated.ports);
  const entries = Object.entries<any>(mod.ports);
  const counts = { input: entries.filter(([, p]) => p.direction === 'input').length, output: entries.filter(([, p]) => p.direction !== 'input').length };
  const indexes = { input: 0, output: 0 };
  return entries.map(([name, p], i) => {
    const side = p.direction === 'input' ? 'input' : 'output';
    return { name, label: labels[i], direction: p.direction, width: p.bits.length,
      y: (height - (Math.max(counts.input, counts.output) * 24 + 76)) / 2 + 60 + indexes[side]++ * 24 };
  });
}

function frameTemplate(child: ProjectModule): string {
  const { width: w, height: h } = child;
  return `<g class="rtl-module-instance" s:type="project-module" data-module="${escapeXml(child.key)}" s:width="${w}" s:height="${h}">
    <s:alias val="${escapeXml(child.key)}"/>
    <rect width="${w}" height="${h}" class="project-boundary"/>
    <text x="${w / 2}" y="22" text-anchor="middle" class="project-instance" s:attribute="ref">instance</text>
    <text x="${w / 2}" y="40" text-anchor="middle" class="project-module-name">${escapeXml(child.name)}</text>
    ${child.ports.map(p => `<text x="${p.direction === 'input' ? 8 : w - 8}" y="${p.y - 5}" text-anchor="${p.direction === 'input' ? 'start' : 'end'}" class="project-port-label">${escapeXml(p.label)}</text>
      <g s:x="${p.direction === 'input' ? 0 : w}" s:y="${p.y}" s:pid="${escapeXml(p.label)}" s:position="${p.direction === 'input' ? 'top' : 'bottom'}"/>`).join('\n')}
  </g>`;
}

export class ProjectPipeline {
  private cache = new Map<string, Cache>();
  private scenes = new Map<string, { fingerprint: string; geometry: string; model: ProjectModule }>();
  private skin = '';
  private projectTop = '';
  // Serialize refreshes so cache publication remains atomic and dispose is safe.
  private pending: Promise<unknown> = Promise.resolve();
  runProject(sources: ProjectSource[], top: string, skin: string, reflow = false): Promise<ProjectResult> {
    const snapshot = sources.map(source => ({ ...source }));
    const task = this.pending.then(() => this.build(snapshot, top, skin, reflow));
    this.pending = task.catch(() => {});
    return task;
  }
  layoutProject(selected: string, expanded: string[], reflow = false): Promise<ProjectResult> {
    const paths = new Set(expanded);
    const task = this.pending.then(() => this.layout(selected, paths, reflow));
    this.pending = task.catch(() => {});
    return task;
  }
  async dispose() { await this.pending; this.cache.clear(); this.scenes.clear(); }

  private async build(sources: ProjectSource[], top: string, skin: string, reflow: boolean): Promise<ProjectResult> {
    const diagnostics: ProjectDiagnostic[] = [];
    if (!/^[a-zA-Z_][\w$]*$/.test(top)) return { ok: false, top, diagnostics, error: 'Choose a top module with a standard SystemVerilog identifier.' };
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-project-'));
    try {
      if (!sources.length) throw new Error('No SystemVerilog sources were selected.');
      // Snapshot all sources, including unsaved headers. Preserve relative paths.
      let root = path.dirname(path.resolve(sources[0].path));
      while (sources.some(s => path.relative(root, path.resolve(s.path)).startsWith('..' + path.sep))) root = path.dirname(root);
      const files = new Map<string, string>();
      for (const source of sources) {
        const dest = path.join(dir, 'sources', path.relative(root, path.resolve(source.path)));
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, source.content);
        files.set(dest, source.path);
      }
      const units = [...files.keys()].filter(f => /\.sv$/i.test(f)).sort((a, b) => Number(/_pkg\.sv$/i.test(b)) - Number(/_pkg\.sv$/i.test(a)) || a.localeCompare(b));
      if (!units.length) throw new Error('No .sv compilation units were found. Headers are included by their source files.');
      const includes = [...new Set([...files.keys()].map(f => path.dirname(f)))].map(d => '-I' + d);
      try {
        const lint = await exec('verilator', ['--lint-only', '-Wall', '-Wno-fatal', '-sv', '--top-module', top, ...includes, ...units], { maxBuffer: 8 * 1024 * 1024, cwd: path.join(dir, 'sources') });
        this.diagnostics(lint.stderr, files, diagnostics);
      } catch (error: any) {
        this.diagnostics(error.stderr || '', files, diagnostics);
        throw new Error(error.stderr || error.message || 'Project lint failed.');
      }
      const runYosys = async (commands: string, name: string) => {
        const script = path.join(dir, name + '.ys');
        await fs.writeFile(script, commands);
        await exec('yosys', ['-q', '-s', script], { maxBuffer: 8 * 1024 * 1024, cwd: path.join(dir, 'sources') });
      };
      const ilPath = path.join(dir, 'elaborated.il'), interfacesPath = path.join(dir, 'interfaces.json');
      await runYosys(`read_verilog -sv ${includes.map(i => '-I ' + quote(i.slice(2))).join(' ')} ${units.map(quote).join(' ')}\nhierarchy -check -top ${top}\nwrite_rtlil ${quote(ilPath)}\nblackbox\nwrite_json ${quote(interfacesPath)}\n`, 'elaborate');
      const il = await fs.readFile(ilPath, 'utf8');
      const blocks = splitRtlil(il);
      const interfaces = JSON.parse(await fs.readFile(interfacesPath, 'utf8')).modules;
      if (!blocks.some(b => b.key === top)) throw new Error(`Top module ${top} was not elaborated.`);
      if (blocks.some(b => Object.values<any>(interfaces[b.key].ports).some(p => p.direction === 'inout'))) throw new Error('Bidirectional inout ports are not supported by the project schematic yet.');
      const skinText = await fs.readFile(skin, 'utf8');
      const skinHash = hash(skinText);
      const next = new Map<string, Cache>();
      const stats = { synthesized: [] as string[], rendered: [] as string[], reused: 0 };
      const interfaceKey = (key: string) => Object.entries<any>(interfaces[key].ports).map(([n, p]) =>
        [n, p.direction, p.bits.length, p.offset, p.upto, interfaces[key].netnames?.[n]?.attributes?.single_bit_vector]);
      const synthesize = async (block: IlModule) => {
        const deps = [...block.block.matchAll(/^  cell (\S+)/gm)].map(m => m[1].replace(/^\\/, '')).filter(k => interfaces[k]);
        const fingerprint = hash(canonicalRtlil(block.block) + JSON.stringify(deps.map(k => [k, interfaceKey(k)])) + RTL_SYNTHESIS_PASSES);
        const old = this.cache.get(block.key);
        let netlist = old?.synthesis === fingerprint ? old.netlist : undefined;
        if (!netlist) {
          const input = path.join(dir, 'module.il'), json = path.join(dir, 'module.json');
          await fs.writeFile(input, 'autoidx ' + (il.match(/^autoidx (\d+)/m)?.[1] || '1') + '\n' + blocks.map(b => b.key === block.key ? 'attribute \\top 1\n' + b.block.replace(/^attribute \\top .*\n/gm, '') : b.stub).join('\n'));
          // The target is marked top in RTLIL; avoid command interpolation of derived names.
          await runYosys(`read_rtlil ${quote(input)}\n${RTL_SYNTHESIS_PASSES}\nwrite_json ${quote(json)}\n`, 'synthesize');
          netlist = JSON.parse(await fs.readFile(json, 'utf8'));
          stats.synthesized.push(block.key);
        } else stats.reused++;
        next.set(block.key, { synthesis: fingerprint, netlist, render: '', module: undefined! });
      };
      for (const block of blocks) await synthesize(block);
      const visiting = new Set<string>();
      const render = async (key: string): Promise<ProjectModule> => {
        const entry = next.get(key)!;
        if (entry.module) return entry.module;
        if (visiting.has(key)) throw new Error('Recursive module instantiation is not supported.');
        visiting.add(key);
        const block = blocks.find(b => b.key === key)!;
        const raw = entry.netlist.modules[key];
        const instances = Object.entries<any>(raw.cells || {}).filter(([, cell]) => next.has(cell.type)).map(([name, cell]) => ({ name, module: cell.type }));
        const children: ProjectModule[] = [];
        for (const type of [...new Set(instances.map(i => i.module))]) children.push(await render(type));
        const old = this.cache.get(key);
        const renderKey = hash(entry.synthesis + skinHash + JSON.stringify(children.map(c => [c.key, c.width, c.height, c.ports])));
        let svg = old?.render === renderKey && !reflow ? old.module.svg : '';
        if (!svg) {
          const netlist = transformYosysNetlist(structuredClone(entry.netlist));
          const json = path.join(dir, 'render.json'), svgPath = path.join(dir, 'render.svg'), customSkin = path.join(dir, 'skin.svg');
          await fs.writeFile(json, JSON.stringify(netlist));
          await fs.writeFile(customSkin, skinText.replace('</svg>', children.map(frameTemplate).join('\n') + '</svg>'));
          await exec('netlistsvg', [json, '-o', svgPath, '--skin', customSkin], { maxBuffer: 8 * 1024 * 1024 });
          svg = postProcessSvgBuses(await fs.readFile(svgPath, 'utf8'));
          stats.rendered.push(key);
        }
        const sidePorts = Math.max(Object.values<any>(raw.ports).filter(p => p.direction === 'input').length, Object.values<any>(raw.ports).filter(p => p.direction !== 'input').length);
        const gutter = Math.max(64, 48 + sidePorts * 8);
        const minWidth = 2 * gutter + 240;
        // Parent layouts reserve the compact interface, not all descendants.
        // Expanded instances receive natural-sized frames in layoutProject().
        const width = minWidth;
        const height = Math.max(sidePorts * 24 + 92, 140);
        const ports = modulePorts(interfaces[key], height);
        const name = String(interfaces[key].attributes?.hdlname || key).split(' ')[0];
        entry.render = renderKey;
        entry.module = { key, name, svg, width, height, gutter, ports, instances, blackbox: block.blackbox,
          revision: hash(renderKey + svg + JSON.stringify({ ports, width, height, gutter })) };
        visiting.delete(key);
        return entry.module;
      };
      await render(top);
      for (const block of blocks) await render(block.key);
      // Publish only complete, successful snapshots. A tool failure keeps all
      // previously displayed modules and their caches intact.
      this.cache = next;
      this.skin = skinText;
      this.projectTop = top;
      return { ok: true, top, diagnostics, modules: [...next.values()].map(e => e.module).filter(Boolean), stats };
    } catch (error: any) {
      return { ok: false, top, diagnostics, error: error.stderr || error.message || 'Project synthesis failed.' };
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }

  private async layout(selected: string, expanded: Set<string>, reflow: boolean): Promise<ProjectResult> {
    const top = this.projectTop;
    if (!this.cache.has(selected)) selected = top;
    if (!this.cache.has(selected)) return { ok: false, top, diagnostics: [], error: 'Generate a valid project snapshot first.' };
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-project-layout-'));
    const models = new Map([...this.cache].map(([key, entry]) => [key, entry.module]));
    const next = new Map(this.scenes);
    const rendered: string[] = [];
    try {
      const visit = async (baseKey: string, instancePath: string): Promise<ProjectModule> => {
        const base = this.cache.get(baseKey)!;
        const key = '@view-' + hash(instancePath).slice(0, 24);
        const children: { instance: string; model: ProjectModule }[] = [];
        for (const instance of base.module.instances) {
          const childPath = instancePath + '/' + encodeURIComponent(instance.name);
          children.push({ instance: instance.name, model: expanded.has(childPath) && !this.cache.get(instance.module)!.module.blackbox
            ? await visit(instance.module, childPath) : this.cache.get(instance.module)!.module });
        }
        const geometry = JSON.stringify(children.map(c => [c.instance, c.model.key, c.model.width, c.model.height, c.model.ports]));
        const fingerprint = hash(base.synthesis + this.skin + geometry);
        const old = this.scenes.get(key);
        const plain = children.every(c => c.model.key === base.netlist.modules[baseKey].cells[c.instance].type);
        let svg = plain ? base.module.svg : old?.fingerprint === fingerprint && !reflow ? old.model.svg : '';
        if (!svg) {
          const netlist = transformYosysNetlist(structuredClone(base.netlist));
          for (const child of children) netlist.modules[baseKey].cells[child.instance].type = child.model.key;
          const json = path.join(dir, 'view.json'), output = path.join(dir, 'view.svg'), skin = path.join(dir, 'view-skin.svg');
          await fs.writeFile(json, JSON.stringify(netlist));
          const unique = [...new Map(children.map(c => [c.model.key, c.model])).values()];
          await fs.writeFile(skin, this.skin.replace('</svg>', unique.map(frameTemplate).join('\n') + '</svg>'));
          await exec('netlistsvg', [json, '-o', output, '--skin', skin], { maxBuffer: 8 * 1024 * 1024 });
          svg = postProcessSvgBuses(await fs.readFile(output, 'utf8'));
          rendered.push(baseKey);
        }
        const attrs = svg.match(/<svg\b[^>]*>/)?.[0] || '';
        const sameInterface = old && JSON.stringify(old.model.ports.map(p => [p.name, p.label, p.direction, p.width])) ===
          JSON.stringify(base.module.ports.map(p => [p.name, p.label, p.direction, p.width]));
        const structureChanged = old && old.geometry !== geometry;
        const keepFrame = old && sameInterface && !structureChanged && !reflow;
        const width = keepFrame ? old.model.width : Math.max(base.module.width, Number(attrs.match(/\bwidth="([^"]+)"/)?.[1]) + 2 * base.module.gutter);
        const height = keepFrame ? old.model.height : Math.max(base.module.height, Number(attrs.match(/\bheight="([^"]+)"/)?.[1]) + 90);
        const ports = keepFrame ? old.model.ports : this.alignedPorts(base.module.ports, svg, width, height, base.module.gutter);
        const model = { ...base.module, key, baseKey, svg, width, height, ports,
          instances: children.map(c => ({ name: c.instance, module: c.model.key })),
          revision: hash(fingerprint + svg + JSON.stringify({ width, height, ports })) };
        next.set(key, { fingerprint, geometry, model }); models.set(key, model);
        return model;
      };
      const root = await visit(selected, selected);
      this.scenes = next;
      return { ok: true, top, diagnostics: [], selected, viewRoot: root.key,
        moduleKeys: [...this.cache.keys()], modules: [...models.values()],
        stats: { synthesized: [], rendered, reused: this.cache.size } };
    } catch (error: any) {
      return { ok: false, top, diagnostics: [], error: error.stderr || error.message || 'Project layout failed.' };
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }

  private alignedPorts(ports: ProjectPort[], svg: string, width: number, height: number, gutter: number): ProjectPort[] {
    const vb = svg.match(/viewBox="([^"]+)"/)?.[1].split(/[ ,]+/).map(Number) || [0, 0, width - 2 * gutter, height - 90];
    const scale = Math.min((width - 2 * gutter) / vb[2], (height - 90) / vb[3]);
    const dy = 60 + (height - 90 - vb[3] * scale) / 2 - vb[1] * scale;
    const groups = [...svg.matchAll(/<g\b[^>]*>/g)].map(m => m[0]);
    const result = ports.map(p => {
      const tag = groups.find(g => g.includes(`id="cell_${escapeXml(p.label)}"`));
      const t = tag?.match(/translate\(([^,]+),([^)]*)\)/);
      return { ...p, y: t ? dy + (+t[2] + 10) * scale : p.y };
    });
    for (const direction of ['input', 'output']) {
      const side = result.filter(p => p.direction === direction).sort((a, b) => a.y - b.y);
      for (let i = 1; i < side.length; i++) side[i].y = Math.max(side[i].y, side[i-1].y + 24);
      if (side.length) side[side.length - 1].y = Math.min(side[side.length - 1].y, height - 24);
      for (let i = side.length - 2; i >= 0; i--) side[i].y = Math.min(side[i].y, side[i+1].y - 24);
    }
    return result;
  }

  private diagnostics(stderr: string, files: Map<string, string>, out: ProjectDiagnostic[]) {
    for (const m of stderr.matchAll(/%(Error|Warning)[^:]*:\s+(.+?):(\d+):(?:(\d+):)?\s+(.*)/g)) {
      out.push({ file: files.get(m[2]) || m[2], line: Math.max(0, +m[3] - 1), column: Math.max(0, +(m[4] || 1) - 1), severity: m[1] as 'Error' | 'Warning', message: m[5] });
    }
  }
}
