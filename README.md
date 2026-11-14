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
Launch with **F5** to inspect rendering in the VS Code Webview.
