import * as vscode from 'vscode';
import { RtlPipeline } from './pipeline';
import { sanitizePalette } from './palette';
import { getWebviewHtml, getViewerTheme, getViewerPalette } from './webview';

let panel: vscode.WebviewPanel | undefined;
let debounceTimer: NodeJS.Timeout | undefined;
const pipeline = new RtlPipeline();
let diagnosticCollection: vscode.DiagnosticCollection;
let customSkinPath: string;

export async function activate(context: vscode.ExtensionContext) {
  customSkinPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'skins', 'dark-digital.svg').fsPath;
  await pipeline.init();
  diagnosticCollection = vscode.languages.createDiagnosticCollection('sv-live-rtl');
  context.subscriptions.push(diagnosticCollection);

  // Command to open the live RTL viewer window
  const openCmd = vscode.commands.registerCommand('sv-live-rtl.openViewer', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('Open a SystemVerilog (.sv) file first.');
      return;
    }

    if (panel) {
      panel.reveal(vscode.ViewColumn.Beside);
    } else {
      panel = vscode.window.createWebviewPanel(
        'svRtlViewer',
        'Live RTL Viewer',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      panel.webview.html = getWebviewHtml(getViewerTheme(), getViewerPalette());
      panel.webview.onDidReceiveMessage(async (message) => {
        if (message.type === 'setTheme' && ['auto', 'dark', 'light', 'custom'].includes(message.theme)) {
          await vscode.workspace.getConfiguration('sv-live-rtl').update(
            'theme', message.theme, vscode.ConfigurationTarget.Global
          );
        } else if (message.type === 'setCustomColors') {
          await vscode.workspace.getConfiguration('sv-live-rtl').update(
            'customColors', sanitizePalette(message.colors), vscode.ConfigurationTarget.Global
          );
        }
      }, undefined, context.subscriptions);
      panel.onDidDispose(() => {
        panel = undefined;
      });
    }

    triggerUpdate(editor.document);
  });

  // Listen to typing events in SystemVerilog files
  const changeDocSub = vscode.workspace.onDidChangeTextDocument((event) => {
    if (!isSystemVerilog(event.document)) {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    // 400ms debounce so we only run synthesis when the user pauses typing
    debounceTimer = setTimeout(() => {
      triggerUpdate(event.document);
    }, 400);
  });

  const configSub = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('sv-live-rtl.theme') || event.affectsConfiguration('sv-live-rtl.customColors')) {
      panel?.webview.postMessage({ type: 'theme', theme: getViewerTheme(), customColors: getViewerPalette() });
    }
  });

  context.subscriptions.push(openCmd, changeDocSub, configSub, {
    dispose: () => pipeline.dispose()
  });
}

function isSystemVerilog(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'systemverilog' || doc.fileName.endsWith('.sv');
}

let currentUpdateId = 0;

async function triggerUpdate(document: vscode.TextDocument) {
  const code = document.getText();
  if (!code.trim()) {
    return;
  }

  const updateId = ++currentUpdateId;

  // Notify webview we are linting/synthesizing
  panel?.webview.postMessage({ type: 'status', state: 'synthesizing' });

  const result = await pipeline.run(code, customSkinPath);

  // If a newer update was triggered while this one was synthesizing, discard this stale result
  if (updateId !== currentUpdateId) {
    return;
  }

  // Update VS Code squiggly lines (Diagnostics)
  const vsDiagnostics = result.diagnostics.map((d) => {
    const range = new vscode.Range(d.line, d.column, d.line, 200);
    const severity =
      d.severity === 'Error'
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning;
    return new vscode.Diagnostic(range, d.message, severity);
  });
  diagnosticCollection.set(document.uri, vsDiagnostics);

  // Update Webview if lint passed
  if (result.lintPassed && result.svg) {
    panel?.webview.postMessage({
      type: 'update',
      svg: result.svg,
      warningCount: result.diagnostics.length
    });
  } else {
    panel?.webview.postMessage({
      type: 'status',
      state: 'lint-failed',
      errorCount: result.diagnostics.filter((d) => d.severity === 'Error').length,
      errorMessage: result.errorMessage
    });
  }
}

export function deactivate() {}
