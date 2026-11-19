# Issues and future work

Maintainer backlog for a fresh chat. This distinguishes confirmed implementation
hazards from supported-scope limits and follow-up ideas. See [AGENTS.md](AGENTS.md)
for architecture and invariants. Update this file when an item is resolved;
do not assume a screenshot's cause without checking its synthesized netlist.

## Confirmed issues

### P1 — Serialize the live pipeline or isolate each run

**Evidence:** `RtlPipeline.run` in [src/pipeline.ts](src/pipeline.ts) reuses the
same temporary `top.sv`, `netlist.json`, `schematic.svg`, and `layout-skin.svg`
for every call. The debounce in [src/extension.ts](src/extension.ts) delays a
new request but does not wait for an earlier run to finish. `currentUpdateId`
prevents a stale result being displayed; it does not protect shared files
while Verilator, Yosys, or netlistsvg are running.

**Status:** confirmed concurrency hazard from code inspection; this is not a
claim that every observed bad schematic was caused by a reproduced race.

**Proposed fix:** serialize/coalesce live snapshots, or give every run its own
temporary directory. Preserve latest-edit behavior, failure diagnostics,
cleanup and the last valid view. Add a regression with overlapping slow runs
that proves one request cannot read another request's files.

### P2 — Restore memory identity labels safely

**Evidence:** while adding memory symbols, the installed netlistsvg 1.0.2
failed to render custom `s:attribute` labels for generated memory-cell IDs
containing periods. The active skin therefore shows stable **MEM READ**,
**MEM WRITE**, and **MEM INIT** titles without an injected array-name label.
The association is still available as `parameters.MEMID` in Yosys JSON. See
[skin notes](resources/skins/README.md) and
[memory symbol tests](tests/memory-symbols.test.cjs).

**Proposed fix:** make a minimal reproduction with a dotted cell ID, then add
memory names through safe SVG post-processing or a renderer fix. Preserve IDs,
XML escaping, port connections and parameter-specialized hierarchy. Do not
restore the known failing attribute-label approach without a regression test,
or patch the global netlistsvg install as the project solution.

## Current limitations

- **Text clearance is conservative.** [src/svgWires.ts](src/svgWires.ts) estimates
  text bounds from character count and translated group positions rather than
  measuring browser font geometry. It tries local detours on either side of
  an obstructing label and retains the original route when clearance cannot
  be found safely, including crowded segments and labels near endpoints. In
  those cases a foreground copy of the label with canvas-colored clearance
  keeps it readable without moving a connection or junction.
  Junction anchors are preserved; candidate detours reject symbols, labels,
  and overlapping parallel wires. Remaining dense-layout/font/transform cases
  need visual investigation and focused fixtures; universal overlap removal
  is not guaranteed.
- **Crossing marks need space.** Rendered orthogonal net segments and dynamic
  module bridges have nonconnection jump arcs. Tight bends, close junctions,
  and crossings too close together may retain straight crossings rather than
  forcing an arc into a label or connection. Arbitrary third-party SVG path
  geometry is outside this implementation's current scope.
- **Project refresh still lints and elaborates all sources.** The selective
  caches skip unchanged module synthesis and rendering, not Verilator/Yosys
  front-end hierarchy work. Expanding/collapsing and changing the selected
  root use cached netlists without running those stages.
- **Source discovery is automatic.** The project includes workspace `.sv` and
  `.svh` files with package-name ordering and inferred include directories.
  There is no `.f` filelist or explicit source-set/order/include-path setting.
  Larger workspaces with alternate tops, duplicate definitions or generated
  sources may need configuration.
- **Hierarchy is preserved.** There is no flattened-view toggle. Explicit
  external black boxes remain collapsed. Project `inout` ports are rejected
  with a supported-scope error; recursive instantiation is unsupported.
- **SystemVerilog support follows the installed Yosys frontend.** Passing lint
  does not guarantee that all language constructs can be synthesized by it.
- **Symbol coverage is incremental.** Legacy/v2 memory read/write/initializer
  cells have dedicated symbols. Other unsupported cells retain netlistsvg's
  generic fallback; there is no unified memory-array/port grouping view.
- **Visual validation is still needed in VS Code.** CLI integration, geometry
  and DOM tests cover many regressions but cannot prove every theme/font/zoom
  combination renders correctly in the actual Webview.

## Prioritized future work

| Priority | Work | Completion evidence |
| --- | --- | --- |
| P1 | Isolate/serialize live pipeline work. | Overlap regression and successful fast-edit/failure recovery in the Extension Host. |
| P2 | Improve dense-label routing and text bounds. | Real crowded RISC-V fixtures, correct endpoints/junctions, no new shared wire segments or label intersections; inspect dark/light themes. |
| P2 | Restore safe memory identity labels. | Dotted-ID regression, multiple arrays/ports unambiguously identified, no netlist connection changes. |
| P2 | Add a repeatable Extension Host visual smoke suite. | Capture live, compact/expanded project, long labels, crossing arcs and custom themes at multiple zoom levels. |
| P3 | Configure project sources, filelists and include paths. | Existing discovery remains the default; tests cover headers/packages, duplicate definitions and paths containing spaces. |
| P3 | Profile whole-project lint/elaboration before optimizing. | Timings distinguish front-end work, module synthesis and visible-scene layout; invalidation still respects dependencies and parameters. |
| P3 | Add an optional flattened view. | Dedicated behavior/cache contract that preserves the existing hierarchical viewer and expansion state. |
| P3 | Extend `inout` support. | Bidirectional connectivity, frame pins, synthesis stubs and UI routing tested end to end. |
| P3 | Expand primitive coverage and memory grouping. | Exact Yosys interfaces retained, meaningful display labels, CLI render/connectivity regressions. |

## Recently completed — do not reopen as missing features

- The project viewer requests readable RTLIL on Yosys versions that support it.
  This restores project generation when Yosys emits twine handles by default.
- Bus routes shorter than 60 SVG units between terminals and junctions keep
  their bus styling without an inline width label or a gap for it.
  Visible crossing jumps also bound the eligible spans on both wires.
  Each original route still gets at most one label.
- Compact collapsed module boxes and layout of only the visible expanded
  hierarchy; ordinary source edits retain unchanged parent layouts.
- Adjustable wire clearance: `sv-live-rtl.wireLaneSpacing` (default 16 SVG
  units, range 6–40) affects ELK routing and module bridge lanes. Refresh/Reflow
  the project after changing it. Expanded frame labels have a separate column.
- Output labels reserve their width and a top strip in the temporary skin's
  layout bounds, keeping incoming trunks outside the label region. Hierarchy
  bridges use emitted pin coordinates rather than a fixed output-glyph offset.
- Larger black connection dots with wire-colored outlines, unconnected
  crossing arcs, and local wire detours around labels. Crossing foregrounds
  repaint their joining shoulders after the clearance pass, with limits that
  prevent a shoulder from drawing through an adjacent arc's gap.
- Dedicated `$memrd`, `$memrd_v2`, `$memwr`, `$memwr_v2`, `$meminit`, and
  `$meminit_v2` symbols. Write/initializer `EN` displays as **MASK**.
- The active skin is also a labelled standalone symbol gallery. Its preview
  origins/captions do not control the layout of generated circuit instances.
- The RISC-V RAM's 32-bit write enable was investigated: its RTL `we` is scalar;
  Yosys represents a 32-bit per-data-bit mask driven by the same control bit.
  This is expected memory-cell semantics, not an extension or RTL width bug;
  [the regression](tests/memory-symbols.test.cjs) verifies it.
- Auto/Dark/Light/Custom palette, shared zoom/pan, inline `/N/` physical wire
  gaps, purple high:low selector labels, stacked bus mux/flop symbols, and
  dedicated 4/8/16/32:1 binary muxes are implemented.
