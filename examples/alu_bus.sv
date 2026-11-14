module alu_bus (
    input  logic [7:0] a,
    input  logic [7:0] b,
    input  logic [2:0] op,
    output logic [7:0] result,
    output logic       zero
);
    always_comb begin
        case (op)
            3'b000: result = a + b;
            3'b001: result = a - b;
            3'b010: result = a & b;
            3'b011: result = a | b;
            3'b100: result = a / b;
            3'b101: result = a ^ b;
            3'b110: result = a >> 1'b1;
            3'b111: result = {1'b1,b[6:0]};
            default: result = '0;
        endcase
        zero = (result == 8'b0);
    end
endmodule
