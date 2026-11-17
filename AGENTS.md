# AGENTS.md — SystemVerilog Live RTL Viewer (`sv-live-rtl`)

This is the handoff for agents starting a fresh chat. Read it before editing,
then inspect the relevant code/tests. Features A, B, and the hierarchical part
of C are implemented; do not restart from the original feature roadmap.
See [issues.md](issues.md) for confirmed issues, current limitations, and the
prioritized backlog. Keep it current when fixing an issue or extending scope.

## Project and implemented behavior

A VS Code extension converting SystemVerilog into interactive schematics:
**Verilator → Yosys → netlistsvg → SVG Webview**. Two separate modes exist:

- **Live file:** `sv-live-rtl.openViewer` / **SV RTL: Open Live Schematic Viewer**.
  Reads the active unsaved `.sv` buffer and updates after a 400 ms typing pause.
- **Project snapshot:** `sv-live-rtl.openProjectViewer` / **SV RTL: Generate
  Multi-File Project Schematic**, also in the Explorer `.sv` context menu.
  Choose a top module. Refresh manually or optionally on save; no synthesis on
  every keystroke in this mode.

Project instances start as compact interface boxes. **+** expands their logic
inside dotted boundaries; **−** collapses it. Repeated instances expand
independently. The View dropdown selects any elaborated module as the root,
including parameter specializations. Both viewers share themes, custom colors,
zoom/pan, bus-width labels, and the local symbol library.

## Source map

| File | Responsibility |
| --- | --- |
| `package.json` | Manifest, commands, settings, build/test scripts, Explorer menu. |
| `src/extension.ts` | Live panel, debounce, diagnostics, stale-result guard, project registration. |
| `src/pipeline.ts` | Async live pipeline; shared `RTL_SYNTHESIS_PASSES`. |
| `src/netlistTransform.ts` | Range/stacked-symbol/mux presentation transforms; SVG bus labels and physical wire gaps. |
| `src/svgWires.ts` | Final SVG wire-text clearance, unconnected crossing jumps, and connection-dot styling. |
| `src/layoutSettings.ts` | Wire-spacing validation, temporary skin ELK overrides and reserved output-label geometry shared by both pipelines. |
| `src/projectPipeline.ts` | Project snapshots/elaboration, per-module synthesis/render caches, compact visible-scene layout. |
| `src/projectViewer.ts` | Source discovery, top picker, project controller, diagnostics, refresh/layout messages and revision diffs. |
| `src/webview.ts`, `src/projectWebview.ts` | Shared HTML/theme/palette UI and project controls/CSS. |
| `src/palette.ts` | Supported color keys, defaults and validation. |
| `resources/project-viewer.js` | Hierarchy DOM, scoped IDs, instance expansion, boundary bridges, selective patches. |
| `resources/viewport.js` | Shared zoom/pan controller and persisted navigation state. |
| `resources/skins/dark-digital.svg` | Active bundled skin, categories, primitive templates and ELK layout options. |
| `resources/skins/default.svg` | Reference netlistsvg 1.0.2 digital library; retain as reference. |
| `resources/skins/README.md`, `LICENSE.netlistsvg` | Symbol-editing notes and upstream attribution/license. |
| `tests/*.test.cjs` | Tests against compiled output, mock Webviews, real CLI renders and mux equivalence. |
| `issues.md` | Confirmed implementation hazards, current limitations and future work. |

`out/` is generated TypeScript output, ignored by Git; edit `src/` and compile.
JavaScript under `resources/` is source. The CLI renderer remains an external
dependency; only its symbol library is vendored.

## Synthesis and presentation contracts

Shared Yosys passes after reading sources and choosing the top:

```text
proc; pmux2shiftx; opt -noff; peepopt; bmuxmap t:$bmux r:S_WIDTH>5 %i; pmuxtree; opt -noff; opt_clean
```

- Preserve word-level arithmetic. `pmux2shiftx`/`peepopt` recover binary case
  selection where possible; remaining parallel muxes become trees. Not all case
  structures can use a direct binary selector.
- Dedicated binary 4:1, 8:1, 16:1, 32:1 muxes have scalar and stacked symbols.
  Larger binary muxes fall back to 2:1 trees. The transform splits packed `$bmux`
  `A` into `$binary_mux<N>[-bus]` aliases with `I0… I<N-1>`, `S`, `Y`. `I0` is
  the least significant word selected by `S=0`. Preserve bit order/constants.
- Multi-bit muxes and supported D flip-flops select `-bus` aliases by **data
  output** width (`Y`/`Q`) with an exact supported-port check. Preserve all
  reset/clock/enable ports; unsupported interfaces keep their original symbol.
  `opt -noff` intentionally retains explicit reset/enable muxes.
- Port labels honor `offset`, `upto`, and explicit single-bit-vector metadata.
  Renaming module ports must also update parent instance `connections` and
  `port_directions`, never just one side.
- Split/join displayed slices use descending `high:low`, e.g. `7:1`; preserve
  source declaration ranges, internal slice identifiers, and bit order.
- Dark-theme scalar wires stay white; buses are thicker and blue. Selectors and
  slice labels are purple. This distinction is intentional, including scalar
  outputs of NOT gates/selectors.
- `/N/` labels occupy **real gaps** near the routed midpoint between terminals
  and branch junctions. Avoid symbols/text/wires/junctions/other labels. Omit a
  label on a route too crowded or short. Do not restore diagonal ticks or
  floating labels above intact wires. `BUS_LABEL_HORIZONTAL_PADDING` in
  `netlistTransform.ts` controls horizontal label-end clearance.
- Dedicated memory-port symbols cover `$memrd`, `$memrd_v2`, `$memwr`,
  `$memwr_v2`, `$meminit`, and `$meminit_v2`, preserving original Yosys pins.
  Writes label `EN` as **MASK** because it is a per-data-bit write mask, not a
  scalar enable. A 32-bit word can therefore have a 32-bit `EN` with a scalar
  RTL enable replicated across all bits. Never narrow it just for display.
- `postProcessSvgBuses` finishes by calling `postProcessSvgWires`. Unconnected
  orthogonal crossings get small semicircular jumps; connected junctions get
  larger black dots with wire-colored outlines. Paint crossing clearances
  before foreground arcs, and repaint the joining shoulders without extending
  into a neighboring arc's gap. Text clearance uses local
  detours while preserving endpoints and interior junction anchors. Candidate
  detours must avoid symbols/labels and parallel wire overlaps. When a safe
  detour cannot fit, foreground text with canvas clearance preserves readability
  without moving the connection. Preserve ancestor selector styling when cloning
  text so purple slice labels retain their color. Dynamic module
  bridges have their own presentation-only crossing decorator. Avoid turning
  a true connection into a jump. Text-bound estimation and crowded-route
  fallback limitations are tracked in `issues.md`.

Skin aliases match cell types literally; `s:pid` must match Yosys port names.
Keep generic and split/join templates, including generic child order, which
netlistsvg relies on. Apply `rtl-register`, `rtl-mux`, `rtl-logic`, `rtl-port`,
or `rtl-neutral` category classes. Scope CSS to `.rtl-schematic` and use palette
variables except intentional contrast details. Edit the active local fork,
not the global installation or reference copy.

The skin's root canvas dimensions and each template's top-level `transform`
positions control its standalone gallery preview. netlistsvg places schematic
instances itself; gallery rearrangement must not change aliases, local symbol
dimensions, primitive paths, or `s:pid` coordinates. Root-level
`data-skin-gallery` captions do not appear in generated schematics. Do not add
a root `viewBox` to the skin: netlistsvg copies it into generated circuits and
can clip or mis-scale their bounds.

## Project caches and visible hierarchy

Selective module updates and compact expandable hierarchy are core requirements.
Do not replace them with a monolithic flattened SVG.

1. Workspace discovery includes existing `.sv`/`.svh`, excludes build/dependency
   directories, and uses open buffers for unsaved content. Snapshots preserve
   relative paths in isolated temp directories. `_pkg.sv` units sort first;
   headers are included, not compiled independently.
2. Refresh lints and elaborates the whole project to resolve parameters and
   dependencies. `splitRtlil` parses **Yosys-generated RTLIL**, not SystemVerilog
   with regex. Each elaborated module synthesizes independently with other
   modules replaced by interface-preserving black-box stubs.
3. Synthesis hashes canonical module RTLIL, direct-child interfaces, and shared
   passes. `canonicalRtlil` ignores source locations/global anonymous allocation
   so unrelated edits do not invalidate siblings. Keep parameter specializations
   distinct and preserve port attributes on stubs, including single-bit vectors.
4. Base renders reserve only **compact child interface boxes**, not descendants'
   full logic. Render hashes include synthesis, skin, and child-frame geometry.
5. `layoutProject(selected, expandedPaths, reflow)` uses cached netlists, with
   **no lint/elaboration/synthesis**. Expanded scene models have stable `@view-…`
   keys per instance path and `baseKey` for the canonical module. Scene-specific
   cell aliases let repeated instances have different expansion states/sizes.
6. Explicit expansion/collapse can lay out affected ancestors again to reclaim
   space. Ordinary logic edits preserve expanded frames and unchanged parent
   SVGs; edited leaves patch in place. Interfaces/visible geometry invalidate
   relevant parents. **Reflow layout** resizes frames while reusing synthesis.
7. Publish caches only after success. Project operations are serialized; the
   controller suppresses stale layout generations. Snapshots send changed
   revisions and current module/scene keys. The Webview namespaces SVG IDs and
   patches affected mounts, retaining unaffected parents and navigation state.

Boundary bridges connect frame pins to the collapsed box or nested SVG's actual
I/O. Preserve endpoints, port width/color, and separation. Prefer straight runs,
then two bends with separate lanes; use detours when shared segments require
it. The active skin uses ELK `NETWORK_SIMPLEX`, 60-unit layer spacing and
30-unit node spacing. Balance compactness and clearance in collapsed and deeply
expanded views. The top-picker regex is only a convenience; Yosys elaboration
is authoritative.

`sv-live-rtl.wireLaneSpacing` is the adjustable wire-spacing setting: default
16 SVG units, clamped to 6–40. `withWireSpacing` modifies a temporary skin's ELK
edge/edge and edge/node spacing; it does not rewrite the skin resource.
`runProject` accepts spacing as its fifth argument, and module metadata carries
`wireLaneSpacing` for boundary bridge routing. Refresh/Reflow the project after
changing it. Keep frame gutters, label clearance and wire pitch consistent.
Expanded frames reserve a label column before their vertical bridge lanes;
rare two-bank detours may compress their pitch to fit the available gutter.

`withOutputLabelSpace(skin, transformedNetlist)` reserves a top text strip and
the full output-label width inside each output node's ELK bounds. This happens
in a temporary skin for live, base-module and visible-scene renders; it does
not modify the reference library. Labels start above/right of the output pin,
allowing incoming trunks to stay clear. Backend frame alignment and Webview
bridges read emitted `s:pid` coordinates; never assume the output pin is always
at a fixed offset such as `y=10`.

## Themes and navigation

- `sv-live-rtl.theme`: `auto` (default), `dark`, `light`, `custom`.
- `sv-live-rtl.customColors`: sanitized `#RRGGBB` canvas/text/wire/bus and
  component fill/outline colors. Update manifest schema, sanitizer/defaults and
  UI together when adding keys. Theme changes recolor immediately without
  synthesis or replacing the current SVG; Auto follows VS Code/high contrast.
- Pointer-anchored wheel/pinch zoom (5–800%), left/middle drag pan, Shift+wheel
  horizontal pan, Fit/−/+/1:1 controls. Focus canvas for `+`/`−`, `F` fit,
  `0` actual size, arrows pan (Shift farther).
- Merge persisted Webview state: viewport, expanded paths, selected module and
  refresh-on-save coexist. Navigation must not synthesize or intercept form
  controls/expansion-button gestures.

## Build, run, and validate

Required host tools on `PATH`: Node/npm, Verilator (5.x+), Yosys (0.30+), and
netlistsvg (usually `npm install -g netlistsvg`). TypeScript is local dev tooling.
Handle paths with spaces and parameter-derived identifiers with safe quoting.

```sh
npm install
npm run compile
npm test
```

`npm test` compiles then runs `node --test tests/*.test.cjs`. For focused checks,
compile then `node --test tests/<name>.test.cjs`. Watch: `npm run watch`.
F5 uses `.vscode/launch.json`, the current VS Code executable and a one-shot
`compile` prelaunch task. Do not make it wait for a foreground watch task.
CLI launch: `code --extensionDevelopmentPath="$(pwd)"`.

- `bus`, `selector-style`, `stacked-symbols`, `wide-mux`: presentation geometry,
  connectivity and real CLI renders. `binary-mux` also runs formal Yosys
  equivalence for selector recovery, priority, defaults and large-mux fallback.
- `project`: hierarchy/includes/parameters, canonicalization, cache reuse,
  interface invalidation, recovery, black boxes and compact expanded scenes.
- `project-webview`: actual script in a small DOM harness, independent
  expansion/scoped IDs/selective updates/boundary routing and controls.
- `wire-appearance`: crossing gaps/shoulders, junctions, text clearance and
  layout settings. `memory-symbols`: actual memory primitive pins and replicated
  write-mask semantics, including renders from the RISC-V RAM.
- `skin-gallery`: standalone template/caption bounds and confirmation that
  gallery metadata/placement do not leak into generated circuit layouts.
- `theme`, `viewport`, `activation`: state, palette safety, gestures, commands
  and bundled resources. Add focused regression tests for functional/geometry
  fixes and run the full suite for cross-pipeline changes.
- Inspect visual changes in the Extension Development Host. DOM/geometry tests
  and raster SVG previews help but do not fully reproduce Webview rendering;
  report GUI validation limits honestly.

Examples: `counter.sv` (live), `alu_bus.sv` (8-bit ALU), `mux_gallery.sv`
(4/8/16/32:1), `examples/project/` (two parameterized stages/shared header),
`examples/risc_example/` (`riscv_top`, larger CPU/ROM/RAM hierarchy). Preserve
intentional RTL/package configuration; do not change functional logic merely
for a simpler picture.

## Required safeguards and known limits

- **Never block the Extension Host:** use async `execFile` and `fs/promises` in
  runtime pipelines, never `execSync`/`readFileSync`.
- **Preserve last valid state:** tool failures update diagnostics/status and
  retain the canvas/successful caches. No modal error toasts while typing.
  Reject stale async results and retain pan/zoom during valid updates.
- Use resource URIs, XML escaping, sanitized settings and safe process arguments.
  Isolate/clean temp files. Inspect diffs and preserve unrelated user changes.
- **Not implemented:** flattened project toggle, `.f` filelists/configurable
  source sets/order/include paths, `inout` rendering, or a richer SystemVerilog
  frontend than installed Yosys. External black boxes remain collapsed.
- Project refresh still runs whole-project lint/front-end elaboration; synthesis
  and render/layout are cached. Live mode is a single buffer, not a project
  build. Its stale-UI guard does not serialize its reusable temp filenames;
  account for overlapping process work if extending that pipeline.
