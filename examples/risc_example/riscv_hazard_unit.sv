`include "riscv_defs.svh"

module riscv_hazard_unit #(
    parameter int REG_ADDR_WIDTH = DEFAULT_REG_ADDR_WIDTH
) (
    // Stage 2 (ID/EX) Register Source Addresses
    input  logic [REG_ADDR_WIDTH-1:0] id_rs1_addr,
    input  logic [REG_ADDR_WIDTH-1:0] id_rs2_addr,

    // Stage 3 (WB) Register Destination & Write Enable
    input  logic [REG_ADDR_WIDTH-1:0] wb_rd_addr,
    input  logic                      wb_reg_write,

    // Control Hazard Flags from Stage 2
    input  logic                      branch_taken,
    input  logic                      jump,
    input  logic                      jalr,

    // Forwarding Controls
    output logic                      forward_a,
    output logic                      forward_b,

    // Pipeline Flush Control
    output logic                      flush_if_id
);
    // Data hazard forwarding: Forward when destination matches source and is not x0
    assign forward_a = wb_reg_write && (wb_rd_addr != '0) && (wb_rd_addr == id_rs1_addr);
    assign forward_b = wb_reg_write && (wb_rd_addr != '0) && (wb_rd_addr == id_rs2_addr);

    // Control hazard flush: If a branch is taken or jump executes in Stage 2,
    // invalidate the speculative instruction fetched into IF/ID in Stage 1
    assign flush_if_id = branch_taken || jump || jalr;

endmodule
