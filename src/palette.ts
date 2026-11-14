export const PALETTE_FIELDS = {
  background: ['Canvas', '#1e1e1e'],
  text: ['Labels', '#d4d4d4'],
  wire: ['Single-bit wires', '#d4d4d4'],
  bus: ['Buses', '#79c0ff'],
  'register-fill': ['Registers · fill', '#1f3a60'],
  'register-stroke': ['Registers · outline', '#58a6ff'],
  'mux-fill': ['Multiplexers · fill', '#4d3817'],
  'mux-stroke': ['Multiplexers · outline', '#d29922'],
  'logic-fill': ['Logic / arithmetic · fill', '#18423b'],
  'logic-stroke': ['Logic / arithmetic · outline', '#3fb950'],
  'port-fill': ['I/O · fill', '#3c2249'],
  'port-stroke': ['I/O · outline', '#bc8cff'],
  'neutral-fill': ['Other symbols · fill', '#292929'],
  'neutral-stroke': ['Other symbols · outline', '#d4d4d4']
} as const;

export type Palette = Record<keyof typeof PALETTE_FIELDS, string>;

/** Only supported keys and CSS-safe hex colors reach the HTML or style API. */
export function sanitizePalette(value: unknown): Palette {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(PALETTE_FIELDS).map(([key, [, fallback]]) => {
    const color = source[key];
    return [key, typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ? color : fallback];
  })) as Palette;
}
