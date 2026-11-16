`include "riscv_defs.svh"

module riscv_imm_gen #(
    parameter int XLEN = DEFAULT_XLEN
) (
    /* verilator lint_off UNUSEDSIGNAL */
    input  logic [31:0]     instr,
    /* verilator lint_on UNUSEDSIGNAL */
    input  logic [2:0]      imm_sel,
    output logic [XLEN-1:0] imm
);
    // Extract raw immediate bit fields per RISC-V specification
    // I-type: 12-bit signed [31:20]
    logic [11:0] imm_i_raw;
    assign imm_i_raw = instr[31:20];

    // S-type: 12-bit signed [31:25], [11:7]
    logic [11:0] imm_s_raw;
    assign imm_s_raw = {instr[31:25], instr[11:7]};

    // B-type: 13-bit signed [31], [7], [30:25], [11:8], 1'b0
    logic [12:0] imm_b_raw;
    assign imm_b_raw = {instr[31], instr[7], instr[30:25], instr[11:8], 1'b0};

    // U-type: 32-bit [31:12], 12'b0
    logic [31:0] imm_u_raw;
    assign imm_u_raw = {instr[31:12], 12'b0};

    // J-type: 21-bit signed [31], [19:12], [20], [30:21], 1'b0
    logic [20:0] imm_j_raw;
    assign imm_j_raw = {instr[31], instr[19:12], instr[20], instr[30:21], 1'b0};

    // Parameterized sign-extension to variable XLEN
    always_comb begin
        case (imm_sel)
            IMM_I:   imm = XLEN'(signed'(imm_i_raw));
            IMM_S:   imm = XLEN'(signed'(imm_s_raw));
            IMM_B:   imm = XLEN'(signed'(imm_b_raw));
            IMM_U:   imm = (XLEN >= 32) ? XLEN'(signed'(imm_u_raw)) : XLEN'(imm_u_raw[XLEN-1:0]);
            IMM_J:   imm = XLEN'(signed'(imm_j_raw));
            default: imm = '0;
        endcase
    end

endmodule
