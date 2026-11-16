`include "riscv_defs.svh"

module riscv_rom #(
    parameter int XLEN = DEFAULT_XLEN
) (
    /* verilator lint_off UNUSEDSIGNAL */
    input  logic [XLEN-1:0] addr,
    /* verilator lint_on UNUSEDSIGNAL */
    output logic [31:0]     data
);
    // Address is byte-aligned; word index uses bits [5:2] for 16-word ROM
    logic [3:0] word_idx;
    assign word_idx = addr[5:2];

    always_comb begin
        case (word_idx)
            4'd0: data = 32'h00100093; // addi x1, x0, 1  (x1 = 1)
            4'd1: data = 32'h00a00113; // addi x2, x0, 10 (x2 = 10)
            4'd2: data = 32'h001181b3; // add  x3, x3, x1 (x3 = x3 + x1)
            4'd3: data = 32'h00108093; // addi x1, x1, 1  (x1 = x1 + 1)
            4'd4: data = 32'hfe20cce3; // blt  x1, x2, -8 (loop to word 2)
            4'd5: data = 32'h00302023; // sw   x3, 0(x0)  (mem[0] = sum)
            4'd6: data = 32'h00002203; // lw   x4, 0(x0)  (x4 = mem[0])
            4'd7: data = 32'h0000006f; // jal  x0, 0      (infinite loop halt)
            default: data = 32'h00000013; // nop (addi x0, x0, 0)
        endcase
    end

endmodule
