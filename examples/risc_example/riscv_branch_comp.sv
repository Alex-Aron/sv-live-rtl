`include "riscv_defs.svh"

module riscv_branch_comp #(
    parameter int XLEN = DEFAULT_XLEN
) (
    input  logic [XLEN-1:0] a,
    input  logic [XLEN-1:0] b,
    input  logic [2:0]      funct3,
    output logic            take_branch
);
    logic eq;
    logic lt_signed;
    logic lt_unsigned;

    assign eq = (a == b);
    assign lt_signed = (signed'(a) < signed'(b));
    assign lt_unsigned = (a < b);

    always_comb begin
        case (funct3)
            BR_BEQ:  take_branch = eq;
            BR_BNE:  take_branch = ~eq;
            BR_BLT:  take_branch = lt_signed;
            BR_BGE:  take_branch = ~lt_signed;
            BR_BLTU: take_branch = lt_unsigned;
            BR_BGEU: take_branch = ~lt_unsigned;
            default: take_branch = 1'b0;
        endcase
    end

endmodule
