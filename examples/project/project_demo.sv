`include "demo_defs.svh"
import demo_defs::*;
module project_demo (
    input logic clk, rst,
    input logic [demo_defs::WIDTH-1:0] a, b,
    input logic [1:0] op,
    output logic [demo_defs::WIDTH-1:0] left_result, right_result,
    output logic [3:0] small_result
);
    // Same synthesized stage, independently expandable instances.
    demo_stage #(.WIDTH(demo_defs::WIDTH)) left_stage
        (.clk(clk), .rst(rst), .a(a), .b(b), .op(op), .q(left_result));
    demo_stage #(.WIDTH(demo_defs::WIDTH)) right_stage
        (.clk(clk), .rst(rst), .a(b), .b(a), .op(op), .q(right_result));
    // A separate parameter specialization of the shared ALU source.
    demo_alu #(.WIDTH(4)) small_alu (.a(a[3:0]), .b(b[3:0]), .op(op), .y(small_result));
endmodule
