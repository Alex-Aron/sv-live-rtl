# SystemVerilog Live RTL Viewer (VS Code Extension Starter)

Live-updating RTL schematic viewer that lints SystemVerilog with **Verilator**, synthesizes behavioral logic into generic gates and flip-flops with **Yosys**, and renders an SVG schematic via **netlistsvg**.

## Prerequisites
Ensure the following CLI binaries are installed and available on your system `PATH`:
- `verilator` (`brew install verilator` or `sudo apt install verilator`)
- `yosys` (`brew install yosys` or `sudo apt install yosys`)
- `netlistsvg` (`npm install -g netlistsvg`)

## Quick Start
1. Extract this archive and open the `sv-live-rtl` folder in VS Code.
2. Run `npm install` in the integrated terminal.
3. Press **F5** to compile and launch the `[Extension Development Host]` window.
4. In the new window, open `examples/counter.sv`.
5. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run **`SV RTL: Open Live Schematic Viewer`**.
6. Edit `counter.sv` and watch the schematic update as you type!

## Schematic themes

The viewer defaults to **Auto (VS Code)**, following the editor background and
foreground and choosing a light or dark symbol palette. VS Code high contrast
themes use the editor foreground for symbol outlines. Use the toolbar's **Theme**
selector to choose **Dark**, **Light**, or **Custom**, or set `sv-live-rtl.theme` in Settings.
The selection is saved in user settings; workspace settings can override it.
Colors update immediately without running synthesis or replacing the schematic.

Select **Custom** to open color pickers for each component group's fill and outline,
as well as canvas, label, wire, and bus colors. Changes preview immediately and are
saved in `sv-live-rtl.customColors`; switching themes keeps your custom palette.

In the default dark palette, registers are blue, multiplexers amber, logic and arithmetic green, and I/O ports
purple. Split/join selectors and their slice labels share the purple I/O accent.
Single-bit wires stay white in the dark palette; buses stay blue. A legend appears below the toolbar. Lint and synthesis errors keep the
last valid schematic visible.

## Zoom and pan

Both the live and project viewers have **Fit**, **− / +**, and **1:1** controls.
Scroll the mouse wheel or pinch the trackpad over the schematic to zoom around
the pointer. Drag the schematic with the left or middle mouse button to pan;
Shift + wheel pans horizontally. Zoom ranges from 5% to 800%.

Click the schematic to focus it, then use **+ / −** to zoom, **F** to fit,
**0** for actual size, and the arrow keys to pan (Shift moves farther).
Navigation does not synthesize or lay out the design again, and manual zoom/pan
is preserved when a live schematic or expanded module updates.

## Detailed Bus Widths & Slash Notation

- **Port Bit-Ranges:** Vector ports explicitly display their bit-range declarations (e.g., `count [3:0]`, `data_in [7:0]`, `in_a [7:4]`), honoring offset and ascending/descending bounds from Yosys. Single-bit scalar signals (like `clk` and `rst`) remain uncluttered without brackets.
- **Bit Selectors:** Split/join slice labels use descending `high:low` notation (e.g., `7:1`, `6:0`). Selector bodies and slice labels use the I/O accent color. This formatting does not change bit order or source port declarations.
- **Bus Line Weights & Color:** Multi-bit nets receive a prominent `stroke-width: 2.5px` and a theme-coordinated bus stroke (`--rtl-bus`, soft blue `#79c0ff` in dark theme, vibrant `#0969da` in light theme).
- **Stacked Symbols:** Muxes and D flip-flops with multi-bit outputs use the digital library's stacked symbols. Single-bit outputs keep the ordinary symbols, even when a mux has a multi-bit select or concatenated input.
- **Inline Bus Widths (`/N/`):** A real gap in the wire contains a centered `/4/`, `/8/`, etc. There is no diagonal tick or label above the wire. Placement follows the routed midpoint between terminals and branch junctions, moving to a nearby clear segment when needed. Labels avoid symbols, port text, junctions, other wires, and other width labels. Routes too short or crowded for a safe label retain their thick wire without a label. The local skin reserves extra layout spacing for these indicators.

## Case statements and muxes

The synthesis pipeline tries to recover binary selectors from Yosys's parallel
mux representation. Binary 4:1, 8:1, 16:1, and 32:1 muxes use dedicated symbols
with numbered data inputs, one output, and a binary select port `S`. Multi-bit
data uses stacked outlines; single-bit data uses a single outline. Input `0`
is at the top and is selected when `S=0`.

For `examples/alu_bus.sv`, this gives one 8:1 mux with eight separate 8-bit inputs
and a 3-bit select wired directly to `op`. The ALU source and its behavior are
unchanged. The packed input in Yosys's binary mux cell is split into words for
display, preserving bit order and connections.

The passes after loading sources and choosing the top module are:

```text
proc; pmux2shiftx; opt -noff; peepopt; bmuxmap t:$bmux r:S_WIDTH>5 %i; pmuxtree; opt -noff; opt_clean
```

Binary selector recovery depends on the case structure and the installed Yosys
optimizations. Binary muxes above 32:1 fall back to trees of 2:1 muxes. Remaining
parallel muxes are expanded with `pmuxtree`; comparisons can remain where needed
for selection and priority. The pipeline keeps arithmetic word-wide and avoids
merging reset/enable muxes into flip-flop variants.

Open **`examples/mux_gallery.sv`** and run **SV RTL: Open Live Schematic Viewer**
to see all four sizes together. Each mux selects one 8-bit word from its input
bank, with 2-, 3-, 4-, or 5-bit select signals. The splitter before each mux
exposes the individual input words. The larger widths on the gallery's input
banks describe all choices together; each mux input and output is 8 bits.

## Multi-file project viewer

Run **SV RTL: Generate Multi-File Project Schematic** from the Command Palette,
or right-click a `.sv` file in Explorer, then choose the top module. The command
opens a separate **Project RTL** tab. It discovers `.sv` and `.svh` files in that
workspace folder, excludes dependencies/build output, and includes unsaved edits
to existing files in each snapshot. Headers are included by the source files;
they are not compiled as separate units.

- **Expand/collapse:** Each instance starts as a dark box with its name and
  ports. Click **+** to reveal its internal schematic inside a dotted boundary;
  click **−** to collapse it. Repeated instances expand independently.
- **Refresh project:** Generate a new snapshot manually, or enable **Refresh on
  save**. Project mode does not synthesize on every keystroke. Failures keep the
  last valid project visible and report diagnostics/status.
- **Module view:** Use the View dropdown to inspect any elaborated module as the
  root. Parameter specializations have separate cached results.
- **Stable layout:** Expansion and ordinary logic edits use reserved module
  frames so parent wires and sibling modules stay in place. Internal diagrams
  scale to fit their frame. Use **Reflow layout** to resize frames and rearrange
  the hierarchy after substantial changes. Fit and zoom controls help navigate.

Linting and hierarchy elaboration still run across the project on refresh to
resolve dependencies and parameters correctly. Synthesis and netlistsvg layout
are cached per elaborated module. A logic-only leaf edit rebuilds that leaf and
patches its expanded instances; unchanged parents reuse their existing SVGs.
Interface changes also invalidate affected parents. Reflow reruns layouts while
reusing synthesized netlists. Cache statistics appear above the schematic.

To try it, open `examples/project/project_demo.sv`, run the project command,
and select **project_demo**. Expand `left_stage` or `right_stage`, then expand
their `arithmetic` and `result_register` instances. Edit `demo_alu.sv` and refresh
to see the two ALU parameter specializations update while parent layouts are
reused. The example also demonstrates a shared `.svh` include.

This first project viewer preserves hierarchy; it does not provide a flattened
view or `.f` filelist configuration yet. Sources must be compatible with the
installed Yosys SystemVerilog frontend. Bidirectional `inout` ports are currently
reported as unsupported. External black-box declarations remain collapsed.

## Local symbol library

`resources/skins/default.svg` is a complete reference copy of the installed
netlistsvg digital library. The viewer renders with the editable fork
`resources/skins/dark-digital.svg`, bundled with the extension. Change or add
symbols there without modifying the global netlistsvg installation. See
`resources/skins/README.md` for palette and symbol editing notes and attribution.

## Validation

Run `npm test` to compile TypeScript and check theme selection, generic cell
coloring, custom palette controls, bus gap geometry, and preservation of the current
schematic during theme changes and tool errors. Integration tests require Verilator,
Yosys, and netlistsvg on PATH. Mux conversion tests also use Yosys formal equivalence
checks for the ALU, overlapping priority cases, and sparse cases with defaults.
Project tests exercise parameterized hierarchies, shared includes, cache reuse,
interface invalidation, failure recovery, and selective updates of expanded SVGs.
Launch with **F5** to inspect rendering in the VS Code Webview.
