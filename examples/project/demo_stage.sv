module demo_stage #(parameter WIDTH = 8) (
    input logic clk, rst,
    input logic [WIDTH-1:0] a, b,
    input logic [1:0] op,
    output logic [WIDTH-1:0] q
);
    logic [WIDTH-1:0] next_q;
    demo_alu #(.WIDTH(WIDTH)) arithmetic (.a(a), .b(b), .op(op), .y(next_q));
    demo_register #(.WIDTH(WIDTH)) result_register (.clk(clk), .rst(rst), .d(next_q), .q(q));
endmodule
