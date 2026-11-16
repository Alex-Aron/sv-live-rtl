import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectPipeline, ProjectSource, ProjectModule, ProjectResult } from './projectPipeline';
import { getProjectWebviewHtml } from './projectWebview';
import { getViewerTheme, getViewerPalette } from './webview';
import { sanitizePalette } from './palette';

const EXCLUDE = '**/{node_modules,.git,out,.vscode-test,obj_dir}/**';
export async function readProjectSources(folder: vscode.WorkspaceFolder): Promise<ProjectSource[]> {
  const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.{sv,svh}'), EXCLUDE);
  return Promise.all(uris.map(async uri => {
    const open = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
    return { path: uri.fsPath, content: open ? open.getText() : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8') };
  }));
}

/** This is a picker catalog only. Yosys parses and elaborates the actual design. */
export function findModuleNames(source: string): string[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"/g, ' ');
  return [...clean.matchAll(/\bmodule\s+(?:(?:automatic|static)\s+)?([a-zA-Z_][\w$]*)/g)].map(m => m[1]);
}

class ProjectView implements vscode.Disposable {
  readonly panel: vscode.WebviewPanel;
  private readonly pipeline = new ProjectPipeline();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('sv-live-rtl-project');
  private readonly subscriptions: vscode.Disposable[] = [];
  private sent = new Map<string, string>();
  private disposed = false;
  private running = false;
  private queued = false;
  private reflowQueued = false;
  auto = false;
  private expanded: string[] = [];
  private selected?: string;
  private layoutGeneration = 0;
  private lastError?: string;

  constructor(private context: vscode.ExtensionContext, readonly folder: vscode.WorkspaceFolder, readonly top: string, onDispose: () => void) {
    this.panel = vscode.window.createWebviewPanel('svProjectRtl', `Project RTL: ${top}`, vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'resources')] });
    this.panel.webview.onDidReceiveMessage(async message => {
      if (message.type === 'projectReady') {
        this.sent.clear(); this.auto = !!message.auto;
        this.expanded = Array.isArray(message.expanded) ? message.expanded.filter((p: unknown) => typeof p === 'string').slice(0, 10000) : [];
        this.selected = typeof message.selected === 'string' ? message.selected : this.top;
        void this.refresh();
      } else if (message.type === 'projectLayout') {
        this.expanded = Array.isArray(message.expanded) ? message.expanded.filter((p: unknown) => typeof p === 'string').slice(0, 10000) : [];
        this.selected = typeof message.selected === 'string' ? message.selected : this.top;
        void this.publishLayout();
      } else if (message.type === 'projectRefresh') void this.refresh(!!message.reflow);
      else if (message.type === 'projectAuto') this.auto = !!message.enabled;
      else if (message.type === 'setTheme' && ['auto', 'dark', 'light', 'custom'].includes(message.theme)) {
        await vscode.workspace.getConfiguration('sv-live-rtl').update('theme', message.theme, vscode.ConfigurationTarget.Global);
      } else if (message.type === 'setCustomColors') {
        await vscode.workspace.getConfiguration('sv-live-rtl').update('customColors', sanitizePalette(message.colors), vscode.ConfigurationTarget.Global);
      }
    }, undefined, this.subscriptions);
    this.panel.onDidDispose(() => { this.dispose(); onDispose(); }, undefined, this.subscriptions);
    const script = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'resources', 'project-viewer.js'));
    this.panel.webview.html = getProjectWebviewHtml(getViewerTheme(), getViewerPalette(), script.toString(), this.panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'resources', 'viewport.js')).toString());
  }
  updateTheme() {
    void this.panel.webview.postMessage({ type: 'theme', theme: getViewerTheme(), customColors: getViewerPalette() });
  }
  async refresh(reflow = false): Promise<void> {
    if (this.disposed) return;
    this.queued = true;
    this.reflowQueued ||= reflow;
    if (this.running) return;
    this.running = true;
    try {
      while (this.queued && !this.disposed) {
        this.queued = false;
        const doReflow = this.reflowQueued; this.reflowQueued = false;
        void this.panel.webview.postMessage({ type: 'projectStatus' });
        try {
          const sources = await readProjectSources(this.folder);
          const skin = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'skins', 'dark-digital.svg').fsPath;
          const result = await this.pipeline.runProject(sources, this.top, skin, doReflow);
          if (this.disposed) return;
          this.diagnostics.clear();
          const byFile = new Map<string, vscode.Diagnostic[]>();
          for (const d of result.diagnostics) {
            if (!sources.some(s => path.resolve(s.path) === path.resolve(d.file))) continue;
            const diagnostic = new vscode.Diagnostic(new vscode.Range(d.line, d.column, d.line, d.column + 1), d.message,
              d.severity === 'Error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
            byFile.set(d.file, [...(byFile.get(d.file) || []), diagnostic]);
          }
          for (const [file, diagnostics] of byFile) this.diagnostics.set(vscode.Uri.file(file), diagnostics);
          if (!result.ok) {
            this.lastError = result.error;
            void this.panel.webview.postMessage({ type: 'projectStatus', error: result.error });
            continue;
          }
          this.lastError = undefined;
          await this.publishLayout(doReflow, result.stats);
        } catch (error: any) {
          if (!this.disposed) void this.panel.webview.postMessage({ type: 'projectStatus', error: error.message || String(error) });
        }
      }
    } finally { this.running = false; }
  }
  private async publishLayout(reflow = false, buildStats?: ProjectResult['stats']) {
    const generation = ++this.layoutGeneration;
    if (!buildStats) void this.panel.webview.postMessage({ type: 'projectStatus', layout: true });
    const result = await this.pipeline.layoutProject(this.selected || this.top, this.expanded, reflow);
    if (this.disposed || generation !== this.layoutGeneration) return;
    if (!result.ok) {
      void this.panel.webview.postMessage({ type: 'projectStatus', error: result.error });
      return;
    }
    this.selected = result.selected;
    const modules = result.modules!;
    const changed: ProjectModule[] = modules.filter(m => this.sent.get(m.key) !== m.revision);
    const stats = { synthesized: buildStats?.synthesized || [],
      rendered: [...new Set([...(buildStats?.rendered || []), ...result.stats!.rendered])],
      reused: buildStats?.reused ?? result.stats!.reused };
    void this.panel.webview.postMessage({ type: 'projectSnapshot', top: this.top, modules: changed,
      keys: result.moduleKeys, sceneKeys: modules.map(m => m.key), viewRoot: result.viewRoot,
      selected: this.selected, stats, reflow });
    this.sent = new Map(modules.map(m => [m.key, m.revision]));
    if (this.lastError) void this.panel.webview.postMessage({ type: 'projectStatus', error: this.lastError });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const subscription of this.subscriptions) subscription.dispose();
    this.diagnostics.dispose();
    this.panel.dispose();
    void this.pipeline.dispose();
  }
}

export function registerProjectViewer(context: vscode.ExtensionContext): vscode.Disposable {
  const views = new Map<string, ProjectView>();
  const command = vscode.commands.registerCommand('sv-live-rtl.openProjectViewer', async (file?: vscode.Uri) => {
    const active = file || vscode.window.activeTextEditor?.document.uri;
    const folder = active ? vscode.workspace.getWorkspaceFolder(active) : vscode.workspace.workspaceFolders?.[0];
    if (!folder) { void vscode.window.showInformationMessage('Open a workspace folder containing your SystemVerilog project first.'); return; }
    const sources = await readProjectSources(folder);
    const choices = sources.flatMap(s => findModuleNames(s.content).map(label => ({ label, description: path.relative(folder.uri.fsPath, s.path), active: s.path === active?.fsPath })));
    choices.sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label));
    if (!choices.length) { void vscode.window.showInformationMessage('No module declarations were found in workspace .sv files.'); return; }
    const selected = await vscode.window.showQuickPick(choices, { title: 'Project RTL: choose the top module', matchOnDescription: true });
    if (!selected) return;
    const key = folder.uri.toString() + ':' + selected.label;
    const existing = views.get(key);
    if (existing) { existing.panel.reveal(); void existing.refresh(); return; }
    views.set(key, new ProjectView(context, folder, selected.label, () => views.delete(key)));
  });
  const saved = vscode.workspace.onDidSaveTextDocument(doc => {
    if (!/\.svh?$/i.test(doc.fileName)) return;
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    for (const view of views.values()) {
      if (view.auto && view.folder.uri.toString() === folder?.uri.toString()) void view.refresh();
    }
  });
  const config = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('sv-live-rtl.theme') || event.affectsConfiguration('sv-live-rtl.customColors')) {
      for (const view of views.values()) view.updateTheme();
    }
  });
  return { dispose: () => { command.dispose(); saved.dispose(); config.dispose(); for (const view of views.values()) view.dispose(); views.clear(); } };
}
