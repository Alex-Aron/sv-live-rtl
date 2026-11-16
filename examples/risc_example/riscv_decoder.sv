`include "riscv_defs.svh"

module riscv_decoder (
    /* verilator lint_off UNUSEDSIGNAL */
    input  logic [31:0] instr,
    /* verilator lint_on UNUSEDSIGNAL */
    output logic [2:0]  imm_sel,
    output logic [3:0]  alu_op,
    output logic        alu_src_a,
    output logic        alu_src_b,
    output logic        reg_write,
    output logic        mem_read,
    output logic        mem_write,
    output logic [1:0]  wb_sel,
    output logic        branch,
    output logic        jump,
    output logic        jalr,
    output logic        illegal_instr
);
    logic [6:0] opcode;
    logic [2:0] funct3;
    logic       funct7_5;

    assign opcode   = instr[6:0];
    assign funct3   = instr[14:12];
    assign funct7_5 = instr[30];

    always_comb begin
        // Safe default control values
        imm_sel       = IMM_I;
        alu_op        = ALU_ADD;
        alu_src_a     = 1'b0; // 0: rs1, 1: pc
        alu_src_b     = 1'b0; // 0: rs2, 1: imm
        reg_write     = 1'b0;
        mem_read      = 1'b0;
        mem_write     = 1'b0;
        wb_sel        = WB_ALU;
        branch        = 1'b0;
        jump          = 1'b0;
        jalr          = 1'b0;
        illegal_instr = 1'b0;

        case (opcode)
            OPCODE_LUI: begin
                imm_sel   = IMM_U;
                reg_write = 1'b1;
                wb_sel    = WB_IMM;
            end

            OPCODE_AUIPC: begin
                imm_sel   = IMM_U;
                alu_src_a = 1'b1; // Add PC
                alu_src_b = 1'b1; // + immediate
                alu_op    = ALU_ADD;
                reg_write = 1'b1;
                wb_sel    = WB_ALU;
            end

            OPCODE_JAL: begin
                imm_sel   = IMM_J;
                jump      = 1'b1;
                reg_write = 1'b1;
                wb_sel    = WB_PC4;
            end

            OPCODE_JALR: begin
                imm_sel   = IMM_I;
                jalr      = 1'b1;
                reg_write = 1'b1;
                wb_sel    = WB_PC4;
            end

            OPCODE_BRANCH: begin
                imm_sel = IMM_B;
                branch  = 1'b1;
            end

            OPCODE_LOAD: begin
                imm_sel   = IMM_I;
                alu_src_b = 1'b1;
                alu_op    = ALU_ADD;
                mem_read  = 1'b1;
                reg_write = 1'b1;
                wb_sel    = WB_MEM;
            end

            OPCODE_STORE: begin
                imm_sel   = IMM_S;
                alu_src_b = 1'b1;
                alu_op    = ALU_ADD;
                mem_write = 1'b1;
            end

            OPCODE_OP_IMM: begin
                imm_sel   = IMM_I;
                alu_src_b = 1'b1;
                reg_write = 1'b1;
                wb_sel    = WB_ALU;
                case (funct3)
                    3'b000:  alu_op = ALU_ADD;
                    3'b010:  alu_op = ALU_SLT;
                    3'b011:  alu_op = ALU_SLTU;
                    3'b100:  alu_op = ALU_XOR;
                    3'b110:  alu_op = ALU_OR;
                    3'b111:  alu_op = ALU_AND;
                    3'b001:  alu_op = ALU_SLL;
                    3'b101:  alu_op = funct7_5 ? ALU_SRA : ALU_SRL;
                    default: alu_op = ALU_ADD;
                endcase
            end

            OPCODE_OP: begin
                alu_src_b = 1'b0; // rs2
                reg_write = 1'b1;
                wb_sel    = WB_ALU;
                case (funct3)
                    3'b000:  alu_op = funct7_5 ? ALU_SUB : ALU_ADD;
                    3'b001:  alu_op = ALU_SLL;
                    3'b010:  alu_op = ALU_SLT;
                    3'b011:  alu_op = ALU_SLTU;
                    3'b100:  alu_op = ALU_XOR;
                    3'b101:  alu_op = funct7_5 ? ALU_SRA : ALU_SRL;
                    3'b110:  alu_op = ALU_OR;
                    3'b111:  alu_op = ALU_AND;
                    default: alu_op = ALU_ADD;
                endcase
            end

            default: begin
                illegal_instr = 1'b1;
            end
        endcase
    end

endmodule
