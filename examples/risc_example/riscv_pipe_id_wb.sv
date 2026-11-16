`include "riscv_defs.svh"

module riscv_pipe_id_wb #(
    parameter int XLEN = DEFAULT_XLEN,
    parameter int REG_ADDR_WIDTH = DEFAULT_REG_ADDR_WIDTH
) (
    input  logic                      clk,
    input  logic                      rst,

    // Stage 2 (Decode / Execute) Inputs
    input  logic [XLEN-1:0]           id_alu_result,
    input  logic [XLEN-1:0]           id_rs2_data,
    input  logic [REG_ADDR_WIDTH-1:0] id_rd_addr,
    input  logic                      id_reg_write,
    input  logic [1:0]                id_wb_sel,
    input  logic [XLEN-1:0]           id_pc_plus_4,
    input  logic [XLEN-1:0]           id_imm,
    input  logic                      id_mem_we,
    input  logic                      id_mem_re,

    // Stage 3 (Memory / Writeback) Outputs
    output logic [XLEN-1:0]           wb_alu_result,
    output logic [XLEN-1:0]           wb_rs2_data,
    output logic [REG_ADDR_WIDTH-1:0] wb_rd_addr,
    output logic                      wb_reg_write,
    output logic [1:0]                wb_wb_sel,
    output logic [XLEN-1:0]           wb_pc_plus_4,
    output logic [XLEN-1:0]           wb_imm,
    output logic                      wb_mem_we,
    output logic                      wb_mem_re
);
    always_ff @(posedge clk) begin
        if (rst) begin
            wb_alu_result <= '0;
            wb_rs2_data   <= '0;
            wb_rd_addr    <= '0;
            wb_reg_write  <= 1'b0;
            wb_wb_sel     <= WB_ALU;
            wb_pc_plus_4  <= '0;
            wb_imm        <= '0;
            wb_mem_we     <= 1'b0;
            wb_mem_re     <= 1'b0;
        end else begin
            wb_alu_result <= id_alu_result;
            wb_rs2_data   <= id_rs2_data;
            wb_rd_addr    <= id_rd_addr;
            wb_reg_write  <= id_reg_write;
            wb_wb_sel     <= id_wb_sel;
            wb_pc_plus_4  <= id_pc_plus_4;
            wb_imm        <= id_imm;
            wb_mem_we     <= id_mem_we;
            wb_mem_re     <= id_mem_re;
        end
    end

endmodule
