`include "riscv_defs.svh"

module riscv_ram #(
    parameter int XLEN = DEFAULT_XLEN,
    parameter int DEPTH = 16
) (
    input  logic            clk,
    input  logic            we,
    /* verilator lint_off UNUSEDSIGNAL */
    input  logic [XLEN-1:0] addr,
    /* verilator lint_on UNUSEDSIGNAL */
    input  logic [XLEN-1:0] wdata,
    output logic [XLEN-1:0] rdata
);
    localparam int ADDR_BITS = $clog2(DEPTH);
    logic [ADDR_BITS-1:0] word_idx;
    assign word_idx = addr[2 +: ADDR_BITS];

    logic [XLEN-1:0] mem [0:DEPTH-1];

    always_ff @(posedge clk) begin
        if (we) begin
            mem[word_idx] <= wdata;
        end
    end

    // Asynchronous read for single-cycle CPU memory access
    assign rdata = mem[word_idx];

endmodule
