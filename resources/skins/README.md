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

Both SVGs and the license are shipped as extension resources. After editing,
run `npm test`, then open the counter example in the Extension Development Host.

Split/join selectors use the `rtl-port rtl-selector` classes. Their solid body
and slice text follow `--rtl-port-stroke`. SVG post-processing formats only the
displayed ranges as `high:low`, preserving internal slice keys and bit wiring.
