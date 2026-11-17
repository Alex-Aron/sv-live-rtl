export const DEFAULT_WIRE_SPACING = 16;

export function normalizeWireSpacing(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(6, Math.min(40, value)) : DEFAULT_WIRE_SPACING;
}

/** ELK options are applied to a temporary skin; the reference library stays intact. */
export function withWireSpacing(skin: string, value: unknown): string {
  const spacing = normalizeWireSpacing(value);
  const options: Record<string, number> = {
    'org.eclipse.elk.spacing.edgeEdge': spacing,
    'org.eclipse.elk.layered.spacing.edgeEdgeBetweenLayers': spacing,
    'org.eclipse.elk.spacing.edgeNode': spacing + 4
  };
  return skin.replace(/<s:layoutEngine\b[^>]*\/>/, element => {
    for (const [key, setting] of Object.entries(options)) {
      const re = new RegExp(`\\s${key.replace(/\./g, '\\.')}\\s*=\\s*["'][^"']*["']`, 'g');
      element = element.replace(re, '');
      element = element.replace('/>', ` ${key}="${setting}"/>`);
    }
    return element;
  });
}

/** Output labels must be part of ELK's node bounds. A centered label above a
 * 30-unit glyph otherwise projects into neighboring incoming wire trunks. The
 * temporary skin keeps the glyph's pin at x=0, puts its label in a reserved top
 * strip, and reserves enough room to the right for the complete signal name. */
export function withOutputLabelSpace(skin: string, netlist: any): string {
  const names = Object.values<any>(netlist.modules || {}).flatMap(module =>
    Object.entries<any>(module.ports || {}).filter(([, port]) => port.direction === 'output').map(([name]) => name));
  const width = Math.max(30, ...names.map(name => Math.ceil(name.length * 7.2 + 8)));
  const set = (tag: string, key: string, value: string) => {
    const re = new RegExp(`\\s${key}="[^"]*"`);
    return re.test(tag) ? tag.replace(re, ` ${key}="${value}"`) : tag.replace(/\/?\s*>$/, ending => ` ${key}="${value}"${ending}`);
  };
  return skin.replace(/<g\b[^>]*s:type="outputExt"[^>]*>[\s\S]*?<\/g>/, block => {
    block = block.replace(/^<g\b[^>]*>/, tag => set(set(tag, 's:width', String(width)), 's:height', '44'));
    if (block.includes('data-output-label-layout="reserved"')) return block;
    block = block.replace(/^<g\b[^>]*>/, tag => set(tag, 'data-output-label-layout', 'reserved'));
    block = block.replace(/<text\b[^>]*s:attribute="ref"[^>]*>/, tag => {
      tag = set(set(set(tag, 'x', '4'), 'y', '12'), 'text-anchor', 'start');
      // Inline style takes priority over the reference .nodelabel middle anchor.
      const style = tag.match(/\sstyle="([^"]*)"/)?.[1] || '';
      return set(tag, 'style', style + ';text-anchor:start');
    });
    block = block.replace(/<path\b[^>]*>/, tag => set(tag, 'transform', 'translate(0,20)'));
    return block.replace(/<g\b[^>]*s:pid="A"[^>]*\/>/, tag => set(tag, 's:y', '30'));
  });
}
