// Four binary mux sizes, each selecting one 8-bit word.
// Each data bank packs input 0 in [7:0], input 1 in [15:8], etc.
// The viewer splits each bank into separate 8-bit mux input wires.
// Select 0 chooses the top input (0), select N-1 the bottom input.
module mux_gallery (
    input  logic [31:0] data4,
    input  logic [1:0] sel4,
    output logic [7:0] out4,
    input  logic [63:0] data8,
    input  logic [2:0] sel8,
    output logic [7:0] out8,
    input  logic [127:0] data16,
    input  logic [3:0] sel16,
    output logic [7:0] out16,
    input  logic [255:0] data32,
    input  logic [4:0] sel32,
    output logic [7:0] out32
);
    // 4:1 mux: binary select, 8-bit output.
    assign out4 = data4[{sel4, 3'b000} +: 8];

    // 8:1 mux: binary select, 8-bit output.
    assign out8 = data8[{sel8, 3'b000} +: 8];

    // 16:1 mux: binary select, 8-bit output.
    assign out16 = data16[{sel16, 3'b000} +: 8];

    // 32:1 mux: binary select, 8-bit output.
    assign out32 = data32[{sel32, 3'b000} +: 8];

endmodule
