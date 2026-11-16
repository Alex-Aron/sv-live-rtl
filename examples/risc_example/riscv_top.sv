`include "riscv_defs.svh"

module riscv_top #(
    parameter int XLEN = DEFAULT_XLEN,
    parameter int REG_ADDR_WIDTH = DEFAULT_REG_ADDR_WIDTH
) (
    input  logic            clk,
    input  logic            rst,

    // Observable Probes for Schematic Inspection
    output logic [XLEN-1:0] pc_debug,
    output logic [XLEN-1:0] alu_debug,
    output logic [XLEN-1:0] mem_wdata_debug,
    output logic            mem_we_debug,
    output logic            mem_re_debug,
    output logic            zero_debug,
    output logic            illegal_debug
);
    // Instruction Memory Bus
    logic [XLEN-1:0] instr_addr;
    logic [31:0]     instr_data;

    // Data Memory Bus
    logic [XLEN-1:0] mem_addr;
    logic [XLEN-1:0] mem_wdata;
    logic [XLEN-1:0] mem_rdata;
    logic            mem_we;
    logic            mem_re;

    // Core CPU Instance
    riscv_core #(
        .XLEN(XLEN),
        .REG_ADDR_WIDTH(REG_ADDR_WIDTH)
    ) cpu (
        .clk(clk),
        .rst(rst),
        .instr_addr(instr_addr),
        .instr_data(instr_data),
        .mem_addr(mem_addr),
        .mem_wdata(mem_wdata),
        .mem_rdata(mem_rdata),
        .mem_we(mem_we),
        .mem_re(mem_re),
        .alu_zero(zero_debug),
        .illegal_instr(illegal_debug)
    );

    // Instruction ROM preloaded with demonstration loop
    riscv_rom #(
        .XLEN(XLEN)
    ) imem (
        .addr(instr_addr),
        .data(instr_data)
    );

    // Synchronous Data RAM
    riscv_ram #(
        .XLEN(XLEN),
        .DEPTH(16)
    ) dmem (
        .clk(clk),
        .we(mem_we),
        .addr(mem_addr),
        .wdata(mem_wdata),
        .rdata(mem_rdata)
    );

    // Assign debug outputs
    assign pc_debug        = instr_addr;
    assign alu_debug       = mem_addr;
    assign mem_wdata_debug = mem_wdata;
    assign mem_we_debug    = mem_we;
    assign mem_re_debug    = mem_re;

endmodule
