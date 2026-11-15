const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs/promises');

test('compiled extension activates and registers both viewer commands', async () => {
  const commands = new Map();
  const disposable = () => ({ dispose() {} });
  const api = {
    Uri: { joinPath: (base, ...parts) => ({ fsPath: path.join(base.fsPath, ...parts) }) },
    commands: { registerCommand: (name, fn) => { commands.set(name, fn); return { dispose: () => commands.delete(name) }; } },
    languages: { createDiagnosticCollection: disposable },
    workspace: { onDidSaveTextDocument: disposable, onDidChangeTextDocument: disposable, onDidChangeConfiguration: disposable }
  };
  const original = Module._load;
  let extension;
  try {
    Module._load = function (id, ...args) { return id === 'vscode' ? api : original.call(this, id, ...args); };
    extension = require('../out/extension');
  } finally { Module._load = original; }
  const context = { extensionUri: { fsPath: process.cwd() }, subscriptions: [] };
  try {
    await extension.activate(context);
    assert.ok(commands.has('sv-live-rtl.openViewer'));
    assert.ok(commands.has('sv-live-rtl.openProjectViewer'));
    await fs.access('resources/project-viewer.js');
    await fs.access('resources/viewport.js');
    await fs.access('resources/skins/dark-digital.svg');
  } finally {
    await Promise.all(context.subscriptions.map(s => s.dispose()));
  }
});
