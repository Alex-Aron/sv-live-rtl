# Parameterized 3-Stage Pipelined RISC-V CPU (`risc_example`)

A 3-stage pipelined RISC-V CPU implementation in SystemVerilog designed for clean, interactive visualization in the **SV Live RTL Viewer**.

---

## 1. 3-Stage Pipeline Microarchitecture

```text
       Stage 1 (IF)                 Stage 2 (ID / EX)                   Stage 3 (MEM / WB)
 ┌──────────────────────┐     ┌────────────────────────────┐     ┌──────────────────────────────┐
 │ • riscv_pc           │     │ • riscv_decoder            │     │ • Data Memory Interface      │
 │ • Instruction Fetch  │ ──► │ • riscv_imm_gen            │ ──► │ • Write-back Mux (ALU/MEM/PC)│
 │ • PC + 4 Adder       │     │ • riscv_regfile (Read)     │     │ • riscv_regfile (Write)      │
 └──────────────────────┘     │ • Forwarding Muxes         │     └──────────────────────────────┘
            │                 │ • riscv_branch_comp (Cond) │                    │
            ▼                 │ • riscv_alu (Execute)      │                    ▼
     [riscv_pipe_if_id]       │ • Branch/Jump Target Calc  │             [Feedback Paths]
                              └────────────────────────────┘       • Forwarding: WB ──► ID/EX
                                             │                     • Writeback:  WB ──► Regfile
                                             ▼
                                     [riscv_pipe_id_wb]
                                             ▲
                              ┌────────────────────────────┐
                              │     riscv_hazard_unit      │
                              │  • Data Forwarding         │
                              │  • Control Hazard (Flush)  │
                              └────────────────────────────┘
```

---

## 2. Module Hierarchy Tree

```text
riscv_top
├── cpu: riscv_core (XLEN=32, REG_ADDR_WIDTH=5)
│   ├── pc_reg: riscv_pc (XLEN=32)
│   ├── pipe_if_id: riscv_pipe_if_id (XLEN=32)             [Pipeline Register 1]
│   ├── decoder: riscv_decoder
│   ├── imm_gen: riscv_imm_gen (XLEN=32)
│   ├── regfile: riscv_regfile (DATA_WIDTH=32, ADDR_WIDTH=5)
│   ├── branch_comp: riscv_branch_comp (XLEN=32)
│   ├── alu: riscv_alu (WIDTH=32)
│   ├── hazard_unit: riscv_hazard_unit (REG_ADDR_WIDTH=5)  [Forwarding & Flush]
│   └── pipe_id_wb: riscv_pipe_id_wb (XLEN=32)             [Pipeline Register 2]
├── imem: riscv_rom (XLEN=32) [Preloaded with demo loop]
└── dmem: riscv_ram (XLEN=32, DEPTH=16)
```

---

## 3. Pipeline Stages & Hazard Handling

1. **Stage 1: Instruction Fetch (IF)**
   * Computes next PC (sequential `PC + 4` or branch/jump redirect from Stage 2).
   * Fetches 32-bit instruction from `imem`.
2. **Pipeline Register 1 (`riscv_pipe_if_id`)**
   * Latches `pc`, `pc_plus_4`, and `instr`.
   * Cleared synchronously with a `NOP` (`addi x0, x0, 0`) upon pipeline flush.
3. **Stage 2: Instruction Decode & Execute (ID / EX)**
   * Decodes instruction, unpacks and sign-extends immediates.
   * Reads register file and applies **data forwarding** (`forward_a`, `forward_b`) directly from Stage 3 when producer/consumer dependencies occur.
   * Evaluates branch condition and calculates branch/jump target addresses.
   * Executes arithmetic, logic, and shift operations in `riscv_alu`.
4. **Pipeline Register 2 (`riscv_pipe_id_wb`)**
   * Latches ALU result, forwarded store data (`rs2`), write destination register (`rd`), and control signals.
5. **Stage 3: Memory & Writeback (MEM / WB)**
   * Accesses data memory (`dmem`) for `load` and `store` operations.
   * Multiplexer selects final writeback data (`ALU`, `MEM`, `PC + 4`, or `IMM`).
   * Writes back to `riscv_regfile` synchronously on the rising clock edge.
6. **Hazard Resolution Unit (`riscv_hazard_unit`)**
   * **Data Hazards:** Resolved via forwarding from the WB stage back to the ID/EX stage with zero stall cycles for ALU dependencies.
   * **Control Hazards:** When a branch is taken or a jump executes in Stage 2, the speculative instruction in Stage 1 is flushed (converted to a 1-cycle bubble in `riscv_pipe_if_id`), and Fetch redirects to the branch target.

---

## 4. Viewing in the RTL Viewer

### Multi-File Project View (Recommended)
1. Open [`riscv_top.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_top.sv) or [`riscv_core.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_core.sv).
2. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run:  
   **`SV RTL: Generate Multi-File Project Schematic`**
3. Select **`riscv_top`** (or **`riscv_core`**).
4. Click the **`+`** icon on any instance (e.g. `cpu`) to expand the pipeline stages and see the pipeline registers and forwarding paths.
5. Use the **View** dropdown in the toolbar to inspect any individual submodule directly (e.g. `riscv_pipe_if_id`, `riscv_hazard_unit`, `riscv_alu`).

### Single-File Live Editing
Open any leaf file (e.g., [`riscv_hazard_unit.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_hazard_unit.sv) or [`riscv_alu.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_alu.sv)) and run **`SV RTL: Open Live RTL Viewer`**.

---

## 5. File Manifest

* [`riscv_pkg.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_pkg.sv): Opcodes, ALU control codes, branch conditions, and package defaults.
* [`riscv_defs.svh`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_defs.svh): Header guard and package import definitions.
* [`riscv_pc.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_pc.sv): Program Counter register and `PC + 4` adder.
* [`riscv_pipe_if_id.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_pipe_if_id.sv): Pipeline Register 1 (IF/ID) with synchronous flush and stall.
* [`riscv_decoder.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_decoder.sv): Instruction decoder and control signal generator.
* [`riscv_imm_gen.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_imm_gen.sv): Immediate generation and sign-extension for I, S, B, U, J types.
* [`riscv_regfile.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_regfile.sv): Dual-read, single-write register file (x0 tied to 0).
* [`riscv_branch_comp.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_branch_comp.sv): Branch comparator for signed/unsigned relational tests.
* [`riscv_alu.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_alu.sv): Parameterized ALU (ADD, SUB, SLL, SRL, SRA, SLT, SLTU, XOR, OR, AND).
* [`riscv_hazard_unit.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_hazard_unit.sv): Data forwarding and control hazard flush detector.
* [`riscv_pipe_id_wb.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_pipe_id_wb.sv): Pipeline Register 2 (ID/WB) latching execute results and control lines.
* [`riscv_core.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_core.sv): 3-Stage Pipelined CPU core datapath and pipeline stage integration.
* [`riscv_rom.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_rom.sv): Preloaded instruction memory containing demonstration loop.
* [`riscv_ram.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_ram.sv): Synchronous data RAM.
* [`riscv_top.sv`](file:///Users/alexaron/Projects/logic/rtl_viewer_vscode/sv-live-rtl/examples/risc_example/riscv_top.sv): Self-contained top-level system combining pipelined core, ROM, RAM, and diagnostic probes.
