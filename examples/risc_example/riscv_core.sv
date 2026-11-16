`include "riscv_defs.svh"

module riscv_core #(
    parameter int XLEN = DEFAULT_XLEN,
    parameter int REG_ADDR_WIDTH = DEFAULT_REG_ADDR_WIDTH
) (
    input  logic                  clk,
    input  logic                  rst,

    // Instruction Memory Interface (Stage 1: IF)
    output logic [XLEN-1:0]       instr_addr,
    input  logic [31:0]           instr_data,

    // Data Memory Interface (Stage 3: MEM/WB)
    output logic [XLEN-1:0]       mem_addr,
    output logic [XLEN-1:0]       mem_wdata,
    input  logic [XLEN-1:0]       mem_rdata,
    output logic                  mem_we,
    output logic                  mem_re,

    // Status / Diagnostic Probes
    output logic                  alu_zero,
    output logic                  illegal_instr
);
    //==========================================================================
    // STAGE 1: INSTRUCTION FETCH (IF)
    //==========================================================================
    logic [XLEN-1:0] if_pc;
    logic [XLEN-1:0] if_pc_plus_4;
    logic [XLEN-1:0] next_pc;

    logic            redirect_pc_en;
    logic [XLEN-1:0] redirect_target;
    logic            flush_if_id;

    // Next PC selection: Redirect on branch/jump in Stage 2, else sequential PC+4
    assign next_pc    = redirect_pc_en ? redirect_target : if_pc_plus_4;
    assign instr_addr = if_pc;

    // Program Counter register
    riscv_pc #(.XLEN(XLEN)) pc_reg (
        .clk(clk),
        .rst(rst),
        .pc_en(1'b1),
        .next_pc(next_pc),
        .pc(if_pc),
        .pc_plus_4(if_pc_plus_4)
    );

    //==========================================================================
    // PIPELINE REGISTER 1: IF / ID
    //==========================================================================
    logic [XLEN-1:0] id_pc;
    logic [XLEN-1:0] id_pc_plus_4;
    logic [31:0]     id_instr;

    riscv_pipe_if_id #(.XLEN(XLEN)) pipe_if_id (
        .clk(clk),
        .rst(rst),
        .flush(flush_if_id),
        .stall(1'b0),
        .if_pc(if_pc),
        .if_pc_plus_4(if_pc_plus_4),
        .if_instr(instr_data),
        .id_pc(id_pc),
        .id_pc_plus_4(id_pc_plus_4),
        .id_instr(id_instr)
    );

    //==========================================================================
    // STAGE 2: INSTRUCTION DECODE & EXECUTE (ID / EX)
    //==========================================================================
    // Instruction fields
    logic [REG_ADDR_WIDTH-1:0] id_rs1_addr;
    logic [REG_ADDR_WIDTH-1:0] id_rs2_addr;
    logic [REG_ADDR_WIDTH-1:0] id_rd_addr;
    logic [2:0]                id_funct3;

    assign id_rs1_addr = REG_ADDR_WIDTH'(id_instr[19:15]);
    assign id_rs2_addr = REG_ADDR_WIDTH'(id_instr[24:20]);
    assign id_rd_addr  = REG_ADDR_WIDTH'(id_instr[11:7]);
    assign id_funct3   = id_instr[14:12];

    // Control signals
    logic [2:0] id_imm_sel;
    logic [3:0] id_alu_op;
    logic       id_alu_src_a;
    logic       id_alu_src_b;
    logic       id_reg_write;
    logic       id_mem_re;
    logic       id_mem_we;
    logic [1:0] id_wb_sel;
    logic       id_branch;
    logic       id_jump;
    logic       id_jalr;

    riscv_decoder decoder (
        .instr(id_instr),
        .imm_sel(id_imm_sel),
        .alu_op(id_alu_op),
        .alu_src_a(id_alu_src_a),
        .alu_src_b(id_alu_src_b),
        .reg_write(id_reg_write),
        .mem_read(id_mem_re),
        .mem_write(id_mem_we),
        .wb_sel(id_wb_sel),
        .branch(id_branch),
        .jump(id_jump),
        .jalr(id_jalr),
        .illegal_instr(illegal_instr)
    );

    // Immediate generator
    logic [XLEN-1:0] id_imm;
    riscv_imm_gen #(.XLEN(XLEN)) imm_gen (
        .instr(id_instr),
        .imm_sel(id_imm_sel),
        .imm(id_imm)
    );

    // Register File: Read ports in Stage 2, Write port in Stage 3 (WB)
    logic [XLEN-1:0] rf_rs1_data;
    logic [XLEN-1:0] rf_rs2_data;
    logic [XLEN-1:0] final_wb_data;
    logic [REG_ADDR_WIDTH-1:0] wb_rd_addr;
    logic                      wb_reg_write;

    riscv_regfile #(
        .DATA_WIDTH(XLEN),
        .ADDR_WIDTH(REG_ADDR_WIDTH)
    ) regfile (
        .clk(clk),
        .rst(rst),
        .reg_write(wb_reg_write),
        .rs1_addr(id_rs1_addr),
        .rs2_addr(id_rs2_addr),
        .rd_addr(wb_rd_addr),
        .rd_wdata(final_wb_data),
        .rs1_rdata(rf_rs1_data),
        .rs2_rdata(rf_rs2_data)
    );

    // Data forwarding multiplexers from Stage 3 (WB) to Stage 2 (ID/EX)
    logic forward_a;
    logic forward_b;
    logic [XLEN-1:0] id_op_a;
    logic [XLEN-1:0] id_op_b;

    assign id_op_a = forward_a ? final_wb_data : rf_rs1_data;
    assign id_op_b = forward_b ? final_wb_data : rf_rs2_data;

    // Branch condition evaluation
    logic branch_cond_met;
    riscv_branch_comp #(.XLEN(XLEN)) branch_comp (
        .a(id_op_a),
        .b(id_op_b),
        .funct3(id_funct3),
        .take_branch(branch_cond_met)
    );

    // Branch & Jump redirect target logic
    logic branch_taken;
    logic [XLEN-1:0] branch_target;
    logic [XLEN-1:0] jump_target;
    logic [XLEN-1:0] jalr_target;

    assign branch_taken   = id_branch && branch_cond_met;
    assign branch_target  = id_pc + id_imm;
    assign jump_target    = id_pc + id_imm;
    assign jalr_target    = (id_op_a + id_imm) & ~XLEN'(1);

    assign redirect_pc_en = branch_taken || id_jump || id_jalr;
    assign redirect_target = id_jalr ? jalr_target : (id_jump ? jump_target : branch_target);

    // ALU operand selection & Arithmetic Logic Unit
    logic [XLEN-1:0] alu_a;
    logic [XLEN-1:0] alu_b;
    logic [XLEN-1:0] id_alu_result;

    assign alu_a = id_alu_src_a ? id_pc : id_op_a;
    assign alu_b = id_alu_src_b ? id_imm : id_op_b;

    riscv_alu #(.WIDTH(XLEN)) alu (
        .a(alu_a),
        .b(alu_b),
        .alu_op(id_alu_op),
        .result(id_alu_result),
        .zero(alu_zero)
    );

    // Hazard & Forwarding Unit
    riscv_hazard_unit #(.REG_ADDR_WIDTH(REG_ADDR_WIDTH)) hazard_unit (
        .id_rs1_addr(id_rs1_addr),
        .id_rs2_addr(id_rs2_addr),
        .wb_rd_addr(wb_rd_addr),
        .wb_reg_write(wb_reg_write),
        .branch_taken(branch_taken),
        .jump(id_jump),
        .jalr(id_jalr),
        .forward_a(forward_a),
        .forward_b(forward_b),
        .flush_if_id(flush_if_id)
    );

    //==========================================================================
    // PIPELINE REGISTER 2: ID / WB
    //==========================================================================
    logic [XLEN-1:0] wb_alu_result;
    logic [XLEN-1:0] wb_rs2_data;
    logic [1:0]      wb_wb_sel;
    logic [XLEN-1:0] wb_pc_plus_4;
    logic [XLEN-1:0] wb_imm;
    logic            wb_mem_we;
    logic            wb_mem_re;

    riscv_pipe_id_wb #(
        .XLEN(XLEN),
        .REG_ADDR_WIDTH(REG_ADDR_WIDTH)
    ) pipe_id_wb (
        .clk(clk),
        .rst(rst),
        .id_alu_result(id_alu_result),
        .id_rs2_data(id_op_b),
        .id_rd_addr(id_rd_addr),
        .id_reg_write(id_reg_write),
        .id_wb_sel(id_wb_sel),
        .id_pc_plus_4(id_pc_plus_4),
        .id_imm(id_imm),
        .id_mem_we(id_mem_we),
        .id_mem_re(id_mem_re),
        .wb_alu_result(wb_alu_result),
        .wb_rs2_data(wb_rs2_data),
        .wb_rd_addr(wb_rd_addr),
        .wb_reg_write(wb_reg_write),
        .wb_wb_sel(wb_wb_sel),
        .wb_pc_plus_4(wb_pc_plus_4),
        .wb_imm(wb_imm),
        .wb_mem_we(wb_mem_we),
        .wb_mem_re(wb_mem_re)
    );

    //==========================================================================
    // STAGE 3: MEMORY ACCESS & WRITEBACK (MEM / WB)
    //==========================================================================
    assign mem_addr  = wb_alu_result;
    assign mem_wdata = wb_rs2_data;
    assign mem_we    = wb_mem_we;
    assign mem_re    = wb_mem_re;

    always_comb begin
        case (wb_wb_sel)
            WB_ALU:  final_wb_data = wb_alu_result;
            WB_MEM:  final_wb_data = mem_rdata;
            WB_PC4:  final_wb_data = wb_pc_plus_4;
            WB_IMM:  final_wb_data = wb_imm;
            default: final_wb_data = wb_alu_result;
        endcase
    end

endmodule
