`include "riscv_defs.svh"

module riscv_pc #(
    parameter int XLEN = riscv_pkg::DEFAULT_XLEN
) (
    input  logic            clk,
    input  logic            rst,
    input  logic            pc_en,
    input  logic [XLEN-1:0] next_pc,
    output logic [XLEN-1:0] pc,
    output logic [XLEN-1:0] pc_plus_4
);
    always_ff @(posedge clk) begin
        if (rst) begin
            pc <= '0;
        end else if (pc_en) begin
            pc <= next_pc;
        end
    end

    assign pc_plus_4 = pc + XLEN'(4);

endmodule
