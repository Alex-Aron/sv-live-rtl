import * as vscode from 'vscode';
import { PALETTE_FIELDS, Palette, sanitizePalette } from './palette';

export type ViewerTheme = 'auto' | 'dark' | 'light' | 'custom';

export function getViewerTheme(): ViewerTheme {
  const theme = vscode.workspace.getConfiguration('sv-live-rtl').get<string>('theme', 'auto');
  return theme === 'dark' || theme === 'light' || theme === 'custom' ? theme : 'auto';
}

export function getViewerPalette(): Palette {
  return sanitizePalette(vscode.workspace.getConfiguration('sv-live-rtl').get('customColors'));
}

export function getWebviewHtml(theme: ViewerTheme, palette?: Palette): string {
  const colors = sanitizePalette(palette);
  const colorInputs = Object.entries(PALETTE_FIELDS).map(([key, [label]]) =>
    `<label>${label}<input type="color" data-color="${key}" value="${colors[key as keyof Palette]}" aria-label="${label}"></label>`
  ).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      --rtl-background: #1e1e1e;
      --rtl-text: #d4d4d4;
      --rtl-wire: #d4d4d4;
      --rtl-bus: #79c0ff;
      --rtl-register-fill: #1f3a60; --rtl-register-stroke: #58a6ff;
      --rtl-mux-fill: #4d3817; --rtl-mux-stroke: #d29922;
      --rtl-logic-fill: #18423b; --rtl-logic-stroke: #3fb950;
      --rtl-port-fill: #3c2249; --rtl-port-stroke: #bc8cff;
      --rtl-neutral-fill: #292929; --rtl-neutral-stroke: #d4d4d4;
      margin: 0; padding: 0;
      background: var(--rtl-background); color: var(--rtl-text);
      font-family: var(--vscode-font-family, sans-serif);
      overflow: hidden; display: flex; flex-direction: column; height: 100vh;
    }
    body[data-theme="light"] {
      --rtl-background: #ffffff; --rtl-text: #24292f; --rtl-wire: #424a53; --rtl-bus: #0969da;
    }
    body[data-theme="light"], body[data-theme="auto"].vscode-light,
    body[data-theme="auto"].vscode-high-contrast-light {
      --rtl-register-fill: #ddedff; --rtl-register-stroke: #175cad;
      --rtl-mux-fill: #fff0c2; --rtl-mux-stroke: #805600;
      --rtl-logic-fill: #daf3e7; --rtl-logic-stroke: #176d3b;
      --rtl-port-fill: #efddff; --rtl-port-stroke: #7540a0;
      --rtl-neutral-fill: #f0f0f0; --rtl-neutral-stroke: #424a53;
    }
    body[data-theme="auto"].vscode-light,
    body[data-theme="auto"].vscode-high-contrast-light { --rtl-bus: #0969da; }
    /* VS Code updates these variables and body classes on theme changes. */
    body[data-theme="auto"] {
      --rtl-background: var(--vscode-editor-background, #1e1e1e);
      --rtl-text: var(--vscode-editor-foreground, #d4d4d4);
      --rtl-wire: var(--vscode-editor-foreground, #d4d4d4);
      --rtl-neutral-fill: var(--vscode-editor-background, #1e1e1e);
      --rtl-neutral-stroke: var(--rtl-wire);
    }
    body[data-theme="auto"].vscode-high-contrast,
    body[data-theme="auto"].vscode-high-contrast-light {
      --rtl-register-fill: var(--rtl-background); --rtl-register-stroke: var(--rtl-text);
      --rtl-mux-fill: var(--rtl-background); --rtl-mux-stroke: var(--rtl-text);
      --rtl-logic-fill: var(--rtl-background); --rtl-logic-stroke: var(--rtl-text);
      --rtl-port-fill: var(--rtl-background); --rtl-port-stroke: var(--rtl-text);
      --rtl-bus: var(--rtl-text);
    }
    #toolbar {
      padding: 8px 14px;
      background: var(--vscode-sideBar-background, var(--rtl-background));
      color: var(--vscode-foreground, var(--rtl-text));
      border-bottom: 1px solid var(--vscode-panel-border, #808080);
      display: flex; gap: 12px; flex-wrap: wrap; align-items: center;
      font-size: 12px;
    }
    #toolbar label { margin-left: auto; }
    select {
      background: var(--vscode-dropdown-background, #333333);
      color: var(--vscode-dropdown-foreground, #ffffff);
      border: 1px solid var(--vscode-dropdown-border, #808080);
      font: inherit; padding: 2px 4px;
    }
    select:focus-visible { outline: 1px solid var(--vscode-focusBorder, #58a6ff); }
    .badge { padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .ok { background: #216e39; color: white; }
    .stale { background: #d29922; color: black; }
    .err { background: #ab2922; color: white; }
    #canvas {
      flex: 1; min-height: 0; display: flex; justify-content: center; align-items: center;
      overflow: auto; cursor: grab;
    }
    #canvas svg {
      background: var(--rtl-background); border-radius: 6px; padding: 16px;
      max-width: 95%; max-height: 90%;
    }
    #custom-colors {
      padding: 8px 14px; max-height: 30vh; overflow: auto;
      border-bottom: 1px solid var(--vscode-panel-border, #808080); font-size: 12px;
    }
    #custom-colors[hidden] { display: none; }
    #color-inputs { display: grid; grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); gap: 8px 20px; margin-top: 8px; }
    #color-inputs label { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    input[type="color"] { width: 32px; height: 24px; padding: 0; cursor: pointer; }
    #legend { display: flex; flex-wrap: wrap; gap: 16px; padding: 6px 14px; font-size: 11px; }
    #legend span::before {
      content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 5px;
      background: var(--fill); border: 1px solid var(--stroke);
    }
  </style>
</head>
<body data-theme="${theme}">
  <div id="toolbar">
    <strong>Live RTL Schematic</strong>
    <label for="theme">Theme</label>
    <select id="theme" aria-label="Schematic color theme">
      <option value="auto">Auto (VS Code)</option>
      <option value="dark">Dark</option>
      <option value="light">Light</option>
      <option value="custom">Custom</option>
    </select>
    <span id="status-badge" class="badge ok" role="status">Ready</span>
  </div>
  <details id="custom-colors" ${theme === 'custom' ? '' : 'hidden'} open>
    <summary>Custom colors</summary>
    <div id="color-inputs">${colorInputs}</div>
  </details>
  <div id="legend" aria-label="Symbol colors">
    <span style="--fill:var(--rtl-register-fill);--stroke:var(--rtl-register-stroke)">Registers</span>
    <span style="--fill:var(--rtl-mux-fill);--stroke:var(--rtl-mux-stroke)">Multiplexers</span>
    <span style="--fill:var(--rtl-logic-fill);--stroke:var(--rtl-logic-stroke)">Logic / Arithmetic</span>
    <span style="--fill:var(--rtl-port-fill);--stroke:var(--rtl-port-stroke)">I/O</span>
    <span style="--fill:var(--rtl-bus);--stroke:var(--rtl-bus)">Buses (/N/)</span>
  </div>
  <div id="canvas">
    <p>Start typing a SystemVerilog module to generate gates and flip-flops...</p>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const canvas = document.getElementById('canvas');
    const badge = document.getElementById('status-badge');
    const themeSelect = document.getElementById('theme');
    const customPanel = document.getElementById('custom-colors');
    const colorInputs = document.querySelectorAll('[data-color]');
    let customColors = ${JSON.stringify(colors)};
    function applyTheme(theme) {
      document.body.dataset.theme = theme;
      themeSelect.value = theme;
      customPanel.hidden = theme !== 'custom';
      for (const [key, color] of Object.entries(customColors)) {
        if (theme === 'custom') document.body.style.setProperty('--rtl-' + key, color);
        else document.body.style.removeProperty('--rtl-' + key);
      }
    }
    applyTheme(document.body.dataset.theme);
    colorInputs.forEach((input) => {
      input.addEventListener('input', () => {
        customColors[input.dataset.color] = input.value;
        applyTheme(themeSelect.value);
      });
      input.addEventListener('change', () => {
        vscode.postMessage({ type: 'setCustomColors', colors: customColors });
      });
    });
    themeSelect.addEventListener('change', () => {
      applyTheme(themeSelect.value);
      vscode.postMessage({ type: 'setTheme', theme: themeSelect.value });
    });

    // Cells without a dedicated symbol use the skin's generic box. Its first
    // text node contains the Yosys cell type, including enabled/reset flop variants.
    function colorGenericCells() {
      canvas.querySelectorAll('.rtl-neutral').forEach((cell) => {
        const type = cell.querySelector('text')?.textContent?.trim() || '';
        let category;
        if (/^\\$(?:_?(?:a|s)?dff|_?(?:a)?dlatch|_?sr)/i.test(type)) category = 'register';
        else if (/^\\$(?:_?(?:b|p)?mux|_?nmux)/i.test(type)) category = 'mux';
        else if (/^\\$(?:alu|macc|lcu|fa|shift|sshl|sshr)/i.test(type)) category = 'logic';
        if (category) {
          cell.classList.remove('rtl-neutral');
          cell.classList.add('rtl-' + category);
        }
      });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'theme' && ['auto', 'dark', 'light', 'custom'].includes(msg.theme)) {
        if (msg.customColors) {
          for (const key of Object.keys(customColors)) {
            if (/^#[0-9a-f]{6}$/i.test(msg.customColors[key] || '')) customColors[key] = msg.customColors[key];
          }
          colorInputs.forEach((input) => { input.value = customColors[input.dataset.color]; });
        }
        applyTheme(msg.theme);
      } else if (msg.type === 'update') {
        canvas.innerHTML = msg.svg;
        colorGenericCells();
        badge.className = 'badge ok';
        badge.textContent = msg.warningCount > 0
          ? \`Live (\${msg.warningCount} warnings)\`
          : 'Live (Lint Clean)';
      } else if (msg.type === 'status') {
        if (msg.state === 'synthesizing') {
          badge.className = 'badge stale';
          badge.textContent = 'Updating...';
        } else if (msg.state === 'lint-failed') {
          badge.className = 'badge err';
          badge.textContent = msg.errorMessage
            ? \`Tool Error: \${msg.errorMessage}\`
            : \`Lint Failed (\${msg.errorCount} errors) - Showing Last Valid RTL\`;
        }
      }
    });
  </script>
</body>
</html>`;
}
