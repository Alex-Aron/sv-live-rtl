# Local netlistsvg digital symbols

- `default.svg`: unmodified copy of `lib/default.svg` from the host's installed
  netlistsvg package (version 1.0.2), retained as a reference.
- `dark-digital.svg`: active fork, passed explicitly to netlistsvg with `--skin`.
  The fork retains the reference symbols and adds scoped styles and category classes, removes inline black
  generic port text, and increases layout spacing to fit inline bus width labels.
- `LICENSE.netlistsvg`: the original MIT license, copyright Neil Turley.

Source project: https://github.com/nturley/netlistsvg. The reference records the
installed file as found, including any existing local changes. Updating the CLI
does not overwrite these copies. The CLI is still an external dependency; this
directory vendors the digital symbol library, not the rendering engine.

To change a symbol, edit its `<g s:type="...">` in `dark-digital.svg`. For a new
symbol, add a group with its dimensions, `<s:alias val="$celltype"/>` entries,
and port groups whose `s:pid` matches the Yosys connection names. Keep the generic
box and split/join templates: netlistsvg uses them for unsupported cells and buses.
Preserve the order of children in generic templates, which netlistsvg relies on.

Opening the active SVG directly shows a labelled gallery: logic, registers,
I/O, and memory ports on the left, with the tall binary mux templates on the
right. The top-level template `transform` values only place symbols in that
gallery; netlistsvg replaces them with circuit layout positions. Root-level
`data-skin-gallery` text captions are omitted from rendered schematics. Leave
the skin root without a `viewBox`: netlistsvg copies root attributes, so a
gallery viewBox would incorrectly constrain every generated circuit. Width
and height provide the standalone canvas instead.

Add an `rtl-register`, `rtl-mux`, `rtl-logic`, `rtl-port`, or `rtl-neutral` class
to the symbol group. Generic boxes for known flop, latch, mux, and arithmetic
families receive their category in `src/webview.ts` using the cell type label.
Unknown module types stay neutral.

`src/netlistTransform.ts` selects the existing `-bus` aliases for muxes and
D flip-flops when their data output (`Y` or `Q`) has multiple bits. It preserves
parameters and connections and checks the symbol's port interface. Register
variants without a matching stacked symbol retain their existing template so
enable/reset pins are preserved. The negative-edge stacked flop's dimensions
include its rear outlines so the layout reserves their space.

The added `binary-mux4`, `binary-mux8`, `binary-mux16`, and `binary-mux32`
templates also have `-bus` variants with stacked outlines. Their display aliases
are `$binary_mux<N>` and `$binary_mux<N>-bus`. The netlist transform splits a
Yosys `$bmux` packed `A` port into `I0` through `I<N-1>`, with the least significant
word at `I0`, and preserves `S` and `Y`. Each symbol has a separate title above
its numbered input rows. Do not change these port names without updating the
transform. `examples/mux_gallery.sv` exercises all four sizes.

Custom palette defaults and allowed keys live in `src/palette.ts`.
Palette CSS variables live in `src/webview.ts`; light/dark settings override the
skin's standalone dark fallback colors. Keep wire junction fills and text styles
in sync when editing palettes. Styles in the skin are scoped to `.rtl-schematic`
so they do not affect the surrounding toolbar and legend.

The active skin uses ELK's `NETWORK_SIMPLEX` layering with 60-unit layer spacing
and 30-unit node spacing to reduce unnecessary wire length while leaving room
for inline bus labels.

Memory port templates cover `$memrd`, `$memrd_v2`, `$memwr`, `$memwr_v2`,
`$meminit`, and `$meminit_v2`. They display `MEM READ`, `MEM WRITE`, or `MEM INIT`
with all original pins. They do not merge port cells or change their connections.
A read-port symbol does not imply the array is read-only: it can share storage
with write ports, as identified by `parameters.MEMID` in the JSON. Array names
are not currently shown: netlistsvg 1.0.2 cannot reliably render custom attribute
labels on the generated cell IDs containing periods. Version 2 reads retain
both reset inputs.

The `EN` pin on writes and initializers is labelled `MASK`: Yosys defines one
enable bit per data bit, so a 32-bit memory has a 32-bit write mask even when the
RTL uses a scalar whole-word write enable. In `examples/risc_example/riscv_ram.sv`,
all 32 mask bits carry the same control signal. Read enables are scalar.
Clock pins are labelled `CLK` without a fixed clock-edge glyph because
`CLK_ENABLE` and `CLK_POLARITY` vary between synchronous and asynchronous ports.
Do not remove unused-looking reset/clock pins or collapse repeated mask bits:
they are part of the actual Yosys primitive interface.

Both SVGs and the license are shipped as extension resources. After editing,
run `npm test`, then open the counter example in the Extension Development Host.

Split/join selectors use the `rtl-port rtl-selector` classes. Their solid body
and slice text follow `--rtl-port-stroke`. SVG post-processing formats only the
displayed ranges as `high:low`, preserving internal slice keys and bit wiring.
