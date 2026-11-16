`include "riscv_defs.svh"

module riscv_regfile #(
    parameter int DATA_WIDTH = DEFAULT_XLEN,
    parameter int ADDR_WIDTH = DEFAULT_REG_ADDR_WIDTH
) (
    input  logic                  clk,
    input  logic                  rst,
    input  logic                  reg_write,
    input  logic [ADDR_WIDTH-1:0] rs1_addr,
    input  logic [ADDR_WIDTH-1:0] rs2_addr,
    input  logic [ADDR_WIDTH-1:0] rd_addr,
    input  logic [DATA_WIDTH-1:0] rd_wdata,
    output logic [DATA_WIDTH-1:0] rs1_rdata,
    output logic [DATA_WIDTH-1:0] rs2_rdata
);
    localparam int NUM_REGS = 1 << ADDR_WIDTH;

    logic [DATA_WIDTH-1:0] registers [0:NUM_REGS-1];

    always_ff @(posedge clk) begin
        if (rst) begin
            for (int i = 0; i < NUM_REGS; i++) begin
                registers[i] <= '0;
            end
        end else if (reg_write && (rd_addr != '0)) begin
            registers[rd_addr] <= rd_wdata;
        end
    end

    // Register x0 is hardwired to zero in RISC-V
    assign rs1_rdata = (rs1_addr == '0) ? '0 : registers[rs1_addr];
    assign rs2_rdata = (rs2_addr == '0) ? '0 : registers[rs2_addr];

endmodule
