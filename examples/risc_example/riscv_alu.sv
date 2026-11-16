`include "riscv_defs.svh"

module riscv_alu #(
    parameter int WIDTH = DEFAULT_XLEN
) (
    input  logic [WIDTH-1:0] a,
    input  logic [WIDTH-1:0] b,
    input  logic [3:0]       alu_op,
    output logic [WIDTH-1:0] result,
    output logic             zero
);
    localparam int SHIFT_BITS = $clog2(WIDTH);
    logic [SHIFT_BITS-1:0] shamt;
    assign shamt = b[SHIFT_BITS-1:0];

    always_comb begin
        case (alu_op)
            ALU_ADD:    result = a + b;
            ALU_SUB:    result = a - b;
            ALU_SLL:    result = a << shamt;
            ALU_SLT:    result = (signed'(a) < signed'(b)) ? WIDTH'(1) : '0;
            ALU_SLTU:   result = (a < b) ? WIDTH'(1) : '0;
            ALU_XOR:    result = a ^ b;
            ALU_SRL:    result = a >> shamt;
            ALU_SRA:    result = WIDTH'(signed'(a) >>> shamt);
            ALU_OR:     result = a | b;
            ALU_AND:    result = a & b;
            ALU_PASS_B: result = b;
            default:    result = '0;
        endcase
    end

    assign zero = (result == '0);

endmodule
