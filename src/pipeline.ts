import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { transformYosysNetlist, postProcessSvgBuses } from './netlistTransform';

const execFileAsync = promisify(execFile);
const VERILATOR_DIAG_REGEX = /%(Error|Warning)[^:]*:\s+[^:]+:(\d+):(?:(\d+):)?\s+(.*)/g;

// Recover binary case selectors and retain multiway muxes for the local skin.
// Larger muxes fall back to trees. Keep flops unmerged so their existing symbols
// and explicit reset/enable logic remain visible in the schematic.
export const RTL_SYNTHESIS_PASSES = [
  'proc', 'pmux2shiftx', 'opt -noff', 'peepopt', 'bmuxmap t:$bmux r:S_WIDTH>5 %i',
  'pmuxtree', 'opt -noff', 'opt_clean'
].join('; ');

export interface LintDiagnostic {
  line: number;
  column: number;
  severity: 'Error' | 'Warning';
  message: string;
}

export interface PipelineResult {
  lintPassed: boolean;
  diagnostics: LintDiagnostic[];
  svg?: string;
  errorMessage?: string;
}

export class RtlPipeline {
  private tmpDir: string = '';

  async init() {
    this.tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-rtl-'));
  }

  async run(svCode: string, customSkinPath?: string): Promise<PipelineResult> {
    if (!this.tmpDir) {
      await this.init();
    }

    const svPath = path.join(this.tmpDir, 'top.sv');
    const jsonPath = path.join(this.tmpDir, 'netlist.json');
    const svgPath = path.join(this.tmpDir, 'schematic.svg');

    await fs.writeFile(svPath, svCode, 'utf8');

    // 1. Run Verilator Lint
    const diagnostics = await this.runVerilatorLint(svPath);
    const hasErrors = diagnostics.some((d) => d.severity === 'Error');

    if (hasErrors) {
      return { lintPassed: false, diagnostics };
    }

    // 2. Synthesize to Gate/Flop JSON via Yosys
    try {
      // pmux2shiftx/peepopt recover binary selection where possible; bmuxmap
      // expands sizes above the skin's 32:1 limit. pmuxtree handles parallel
      // muxes whose selectors cannot be recovered (e.g. arbitrary decoders).
      const yosysCmd = `read_verilog -sv "${svPath}"; hierarchy -auto-top; ${RTL_SYNTHESIS_PASSES}; write_json "${jsonPath}"`;
      await execFileAsync('yosys', ['-q', '-p', yosysCmd]);

      // Feature B: Pre-process JSON netlist to annotate vector bit-ranges on port keys
      const rawJsonStr = await fs.readFile(jsonPath, 'utf8');
      const rawJson = JSON.parse(rawJsonStr);
      const transformedJson = transformYosysNetlist(rawJson);
      await fs.writeFile(jsonPath, JSON.stringify(transformedJson), 'utf8');

      // 3. Convert Yosys JSON to SVG schematic via netlistsvg
      const netlistArgs = [jsonPath, '-o', svgPath];
      if (customSkinPath) {
        netlistArgs.push('--skin', customSkinPath);
      }
      await execFileAsync('netlistsvg', netlistArgs);

      // Feature B: Post-process SVG to add bus classes and inline /N/ labels in wire gaps
      const rawSvg = await fs.readFile(svgPath, 'utf8');
      const svg = postProcessSvgBuses(rawSvg);
      return { lintPassed: true, diagnostics, svg };
    } catch (err: any) {
      return {
        lintPassed: false,
        diagnostics,
        errorMessage: err.stderr || err.message || 'Synthesis failed'
      };
    }
  }

  private async runVerilatorLint(svPath: string): Promise<LintDiagnostic[]> {
    try {
      await execFileAsync('verilator', ['--lint-only', '-Wall', '-sv', svPath]);
      return [];
    } catch (err: any) {
      const stderr: string = err.stderr || '';
      return this.parseVerilatorOutput(stderr);
    }
  }

  private parseVerilatorOutput(output: string): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];
    VERILATOR_DIAG_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = VERILATOR_DIAG_REGEX.exec(output)) !== null) {
      diagnostics.push({
        severity: match[1] === 'Error' ? 'Error' : 'Warning',
        line: Math.max(0, parseInt(match[2], 10) - 1),
        column: match[3] ? Math.max(0, parseInt(match[3], 10) - 1) : 0,
        message: match[4].trim()
      });
    }
    return diagnostics;
  }

  async dispose() {
    if (this.tmpDir) {
      await fs.rm(this.tmpDir, { recursive: true, force: true });
    }
  }
}
