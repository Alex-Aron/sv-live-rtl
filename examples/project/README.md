# Hierarchical project demo

Open `project_demo.sv` and run **SV RTL: Generate Multi-File Project Schematic**.
Choose **project_demo** in the module picker.

```text
project_demo
├── left_stage: demo_stage (WIDTH=8)
│   ├── arithmetic: demo_alu (WIDTH=8)
│   └── result_register: demo_register (WIDTH=8)
├── right_stage: demo_stage (WIDTH=8)
│   ├── arithmetic: demo_alu (WIDTH=8)
│   └── result_register: demo_register (WIDTH=8)
└── small_alu: demo_alu (WIDTH=4)
```

Click an instance's **+** to expand it. The two stage instances share synthesized
module data but keep independent expansion states. The two ALU widths are
separate Yosys parameter specializations.

For an incremental update, change the XOR expression in `demo_alu.sv` to OR,
then click **Refresh project**, or save with **Refresh on save** enabled. Only
the two ALU specializations should be synthesized and laid out again; the stage,
register, and top-level layouts should be reused. Restore XOR afterward if desired.

Collapsed instances use compact boxes. Expanding an instance reserves room for
its contents and rearranges affected ancestors, using cached synthesis results.
Ordinary source edits preserve those expanded frame sizes; **Reflow layout**
updates them after larger changes. **Fit** shows the entire current module, and
the View dropdown allows inspecting a child on its own.

`demo_defs.svh` supplies the top-level data width. The viewer snapshots this
header and unsaved source edits alongside the compilation units.
