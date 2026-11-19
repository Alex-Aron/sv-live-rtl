import { getWebviewHtml, ViewerTheme } from './webview';
import { Palette } from './palette';

export function getProjectWebviewHtml(theme: ViewerTheme, palette: Palette, scriptUri: string, viewportScriptUri?: string, dragBlocksScriptUri?: string): string {
  return getWebviewHtml(theme, palette, viewportScriptUri, dragBlocksScriptUri, true)
    .replace('<strong>Live RTL Schematic</strong>', '<strong>Project RTL</strong>')
    .replace('</style>', `
      #canvas { display: block; padding: 18px; }
      #canvas svg { max-width: none; max-height: none; padding: 0; border-radius: 0; }
      #project-controls { display:flex; flex-wrap:wrap; gap:10px; align-items:center; padding:8px 14px; font-size:12px; }
      #project-controls button { background:var(--vscode-button-background,#175cad); color:var(--vscode-button-foreground,#fff); border:0; padding:4px 9px; cursor:pointer; }
      #project-controls label { display:flex; align-items:center; gap:4px; }
      #project-info { padding:0 14px 6px; font-size:11px; }
      #project-root { display:inline-block; border:2px dashed var(--rtl-neutral-stroke); padding:12px; border-radius:6px; }
      #root-heading { display:flex; gap:10px; align-items:center; padding-bottom:10px; }
      #root-heading button { cursor:pointer; }
      #project-error { color:var(--vscode-errorForeground,#f85149); white-space:pre-wrap; max-height:160px; overflow:auto; padding:0 14px; font-size:12px; }
      .rtl-schematic .project-boundary { fill:var(--rtl-background); stroke:var(--rtl-neutral-stroke); stroke-dasharray:5 4; }
      .rtl-schematic .project-collapsed { fill:var(--rtl-neutral-fill); stroke:var(--rtl-neutral-stroke); }
      .rtl-schematic .project-port-label { fill:var(--rtl-port-stroke); }
      .rtl-schematic .project-toggle rect { fill:var(--rtl-neutral-fill); stroke:var(--rtl-port-stroke); }
      .rtl-schematic .project-toggle text { fill:var(--rtl-port-stroke); font-size:16px; text-anchor:middle; }
      .project-toggle { cursor:pointer; }
      .project-toggle:focus { outline:2px solid var(--vscode-focusBorder,#58a6ff); }
      .rtl-schematic .project-bridge { fill:none; stroke:var(--rtl-wire); }
      .rtl-schematic .project-bridge.bus { stroke:var(--rtl-bus); stroke-width:2.5px; }
      .rtl-schematic .project-instance { font-size:12px; }
      .rtl-schematic .project-module-name { fill:var(--rtl-port-stroke); }
      </style>`)
    .replace('<div id="canvas">', `<div id="project-controls">
      <button id="project-refresh">Refresh project</button>
      <button id="project-reflow" title="Resize reserved module frames and rearrange the project">Reflow layout</button>
      <label>View <select id="project-module" aria-label="Module to view"></select></label>
      <label><input type="checkbox" id="project-auto">Refresh on save</label>
      </div><div id="project-info">Generate a project snapshot to begin.</div>
      <div id="project-error" role="alert"></div><div id="canvas">`)
    .replace('</body>', `<script src="${scriptUri.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></script></body>`);
}
