# AGENTS.md — SystemVerilog Live RTL Viewer (`sv-live-rtl`)

## 1. Project Overview
`sv-live-rtl` is a VS Code extension that provides a real-time, interactive RTL schematic viewer for SystemVerilog (`.sv`) files. As a user types combinational and sequential logic in the editor, the extension lints the unsaved buffer and, upon passing, synthesizes the hardware description into generic gates, multiplexers, and flip-flops, live-updating an SVG schematic inside a VS Code Webview panel.

---

## 2. Current Architecture & Pipeline

```text
[VS Code Active Editor (.sv)]
       │ (onDidChangeTextDocument + 400ms Debounce)
       ▼
[Stage 1: Linter] ──► `verilator --lint-only -Wall -sv <temp_file.sv>`
       │               ├─ Fails: Update VS Code Diagnostics (squiggly lines), keep last valid SVG in Webview
       │               └─ Passes: Proceed to Stage 2
       ▼
[Stage 2: Synthesis] ──► `yosys -q -p "read_verilog -sv <file>; hierarchy -auto-top; proc; opt_clean; write_json <out.json>"`
       │                 (Elaborates behavioral SV into $dff, $adff, $mux, $add, logic gates, etc.)
       ▼
[Stage 3: Layout & Render] ──► `netlistsvg <out.json> -o <out.svg> [--skin <custom_skin.svg>]`
       ▼
[Stage 4: VS Code Webview] ──► `panel.webview.postMessage({ type: 'update', svg })`
```

### Core Files
* `package.json`: Extension manifest, activation events (`onLanguage:systemverilog`), and command definitions.
* `src/extension.ts`: Manages VS Code extension lifecycle, 400ms keystroke debouncer, `vscode.DiagnosticCollection` for Verilator errors/warnings, and the Webview panel host.
* `src/pipeline.ts`: Manages an isolated OS temporary directory (`os.tmpdir()`), writes unsaved editor buffers to disk, spawns child processes (`verilator`, `yosys`, `netlistsvg`), parses Verilator stderr into structured diagnostics, and returns the rendered SVG.
* `examples/counter.sv`: Sample 4-bit synchronous counter for testing live synthesis.

---

## 3. Environment & External Dependencies
Agents modifying or testing this repository should assume the following CLI tools are installed on the host `PATH`:
* `verilator` (v5.x+)
* `yosys` (v0.30+)
* `netlistsvg` (installed globally via `npm install -g netlistsvg` or locally in `node_modules/.bin/netlistsvg`)

### Build & Run Commands
* Install dependencies: `npm install`
* Compile TypeScript once: `npm run compile`
* Watch mode: `npm run watch`
* Launch Extension Host from CLI: `code --extensionDevelopmentPath="$(pwd)"` (or press `F5` inside VS Code)

---

## 4. Roadmap & Planned Features (Instructions for AI Agents)

When implementing any of the following features, preserve the existing non-flickering live-update behavior for single-file editing.

### Feature A: Dark Mode & Custom Symbol Color Palette
**Goal:** Replace the stark white schematic background with a cohesive dark theme that matches VS Code (`#1e1e1e`), and color-code different hardware primitives (e.g., sequential flip-flops vs. combinational gates vs. multiplexers vs. I/O ports).

**Implementation Strategy:**
1. Create a `resources/skins/` directory in the repository containing a custom `dark-digital.svg` skin file (forked from `netlistsvg`'s `lib/default.svg`).
2. Pass `--skin <path_to_skin>` to `netlistsvg` via `RtlPipeline.run(svCode, customSkinPath)` in `src/pipeline.ts`.
3. Inside the custom skin SVG and/or Webview CSS (`src/extension.ts`):
   * Set the canvas/SVG background to `#1e1e1e` and default wire strokes to `#d4d4d4`.
   * Apply a distinct color palette to symbol groups (`s:type` in the skin file or CSS selectors on `.cell_*` classes):
     * **Flip-Flops / Registers (`$dff`, `$adff`, `$dffe`, `dff*`):** Soft blue/indigo fill (`#1f3a60`, stroke `#58a6ff`).
     * **Multiplexers (`$mux`, `$pmux`, `mux*`):** Warm amber/gold fill (`#4d3817`, stroke `#d29922`).
     * **Arithmetic / Logic Gates (`$add`, `$sub`, `$and`, `$or`, `$xor`):** Teal/emerald fill (`#18423b`, stroke `#3fb950`).
     * **Input / Output Ports (`$inputExt`, `$outputExt`):** Purple/magenta accent (`#3c2249`, stroke `#bc8cff`).
4. Add a toggle button in the Webview toolbar (`Light / Dark / Palette`) or sync automatically with VS Code's `vscode.window.activeColorTheme`.

---

### Feature B: Detailed Bus Widths (`count [3:0]` and `/4/` Slash Notation)
**Goal:** Explicitly show vector bit-ranges on signal/port labels (e.g., `count [3:0]` instead of just `count`) and render standard hardware schematic slash notation (`/4/`) on multi-bit buses.

**Implementation Strategy:**
1. **JSON Netlist Pre-processing (Between Stage 2 and Stage 3):**
   * Before calling `netlistsvg`, read and parse the Yosys `netlist.json` file in Node.js (`src/pipeline.ts` or a dedicated `src/netlistTransform.ts` module).
   * Inspect `modules.<top>.ports` and `modules.<top>.netnames`. Each port/net has a `bits` array (e.g., `"bits": [2, 3, 4, 5]`).
   * If `bits.length > 1`:
     * Rename or alias the port/net key in the JSON from `count` to `count [N-1:0]` (or parse the `"offset"` and `"upto"` attributes in Yosys `netnames` to preserve exact declarations like `[7:4]`).
2. **Bus Slash Indicators (`/4/`) & Line Weights:**
   * `netlistsvg` automatically attaches CSS classes `.width_<N>` to `<path>` wires and `.busLabel_<N>` to bus width labels based on the number of bits in the connection.
   * Alternatively, post-process the generated SVG (or configure the custom skin) to:
     * Render multi-bit wires (`width > 1`) with a thicker stroke (`stroke-width: 2.5px`) and a distinct bus color.
     * Inject a diagonal slash tick (`<line>` or `<path>`) and a `<text>` node reading `/N/` (e.g., `/4/`) at the midpoint of multi-bit net segments, or ensure `netlistsvg`'s native bus label generation is styled and visible.

---

### Feature C: Multi-File Project RTL View (On-Demand / Static Snapshot)
**Goal:** Allow users to generate a complete hierarchical or flattened RTL schematic across multiple `.sv` files in their workspace (e.g., a top-level module instantiating submodules, plus package definitions). Unlike the single-file mode, **this mode does not need to update live on every keystroke**—it should be triggered on-demand (via a command or toolbar button).

**Implementation Strategy:**
1. **New VS Code Commands (`package.json` & `src/extension.ts`):**
   * `sv-live-rtl.openProjectViewer`: `"SV RTL: Generate Multi-File Project Schematic"`
   * Optionally allow the user to right-click a top-level `.sv` file in the Explorer or pick a top module via `vscode.window.showQuickPick`.
2. **File Discovery & Ordering:**
   * Discover all `.sv` and `.svh` files in the workspace (`vscode.workspace.findFiles('**/*.sv')`), or read a standard `.f` filelist if present.
   * Ensure packages (`*_pkg.sv`) are passed first so types/structs resolve cleanly.
3. **Multi-File Pipeline (`RtlPipeline.runProject(files, topModule)`):**
   * **Lint Step:** Run `verilator --lint-only -Wall -sv --top-module <top> <...all_sv_files>` (with `-I<include_dirs>`).
   * **Synthesis Step:** Run Yosys with all source files loaded:
     * *Hierarchical View (Default):* `read_verilog -sv <files...>; hierarchy -top <topModule>; proc; opt_clean; write_json <out.json>` (submodules appear as connected black/grey boxes with their port interfaces).
     * *Flattened View (Optional Toggle):* Add `flatten;` before `opt_clean;` if the user wants to see logic across module boundaries merged into one schematic.
4. **UI Separation:**
   * Open in a dedicated Webview tab (`Project RTL: <topModule>`) with a manual **"Refresh / Re-synthesize Project"** button in the toolbar and a dropdown to switch which module in the hierarchy is currently rendered (`netlistsvg` renders the top module or a specified submodule from the Yosys JSON).

---

## 5. Coding Guidelines for Agents
* **Never block the VS Code Extension Host:** Always use asynchronous calls (`execFileAsync`, `fs/promises`) in `src/pipeline.ts`. Never use `execSync` or `readFileSync`.
* **Graceful Failure Handling:** While the user is actively typing in single-file mode, syntax errors are expected on 80% of keystrokes. Never pop up modal `vscode.window.showErrorMessage` toasts during live typing—report issues solely via `DiagnosticCollection` and the Webview status badge.
* **Preserve Last Valid State:** Never clear the Webview canvas when Verilator or Yosys fails; keep the last valid schematic visible and update only the status indicator to `Stale / Lint Failed`.