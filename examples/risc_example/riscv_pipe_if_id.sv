`include "riscv_defs.svh"

module riscv_pipe_if_id #(
    parameter int XLEN = DEFAULT_XLEN
) (
    input  logic            clk,
    input  logic            rst,
    input  logic            flush,
    input  logic            stall,

    // Stage 1 (Fetch) Inputs
    input  logic [XLEN-1:0] if_pc,
    input  logic [XLEN-1:0] if_pc_plus_4,
    input  logic [31:0]     if_instr,

    // Stage 2 (Decode / Execute) Outputs
    output logic [XLEN-1:0] id_pc,
    output logic [XLEN-1:0] id_pc_plus_4,
    output logic [31:0]     id_instr
);
    // RISC-V NOP: addi x0, x0, 0 (0x00000013)
    localparam logic [31:0] NOP_INSTR = 32'h00000013;

    always_ff @(posedge clk) begin
        if (rst || flush) begin
            id_pc        <= '0;
            id_pc_plus_4 <= '0;
            id_instr     <= NOP_INSTR;
        end else if (!stall) begin
            id_pc        <= if_pc;
            id_pc_plus_4 <= if_pc_plus_4;
            id_instr     <= if_instr;
        end
    end

endmodule
