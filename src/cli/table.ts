/**
 * A minimal fixed-width table renderer.
 *
 * Written rather than taken from a dependency because the requirement is narrow:
 * numbers right-aligned, text left-aligned, and column widths measured on the
 * text without its colour escapes. Getting that last part wrong is what makes
 * most coloured terminal tables come out ragged.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI colour escapes is the point here, and ESC is their introducer.
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

export type Alignment = 'left' | 'right';

export interface Column {
  readonly header: string;
  readonly align?: Alignment;
}

function visibleLength(text: string): number {
  return text.replace(ANSI_PATTERN, '').length;
}

function pad(text: string, width: number, align: Alignment): string {
  const padding = ' '.repeat(Math.max(0, width - visibleLength(text)));
  return align === 'right' ? padding + text : text + padding;
}

export function renderTable(
  columns: readonly Column[],
  rows: readonly (readonly string[])[],
  options: { readonly dim?: (text: string) => string } = {},
): string {
  const dim = options.dim ?? ((text: string) => text);

  const widths = columns.map((column, index) => {
    const cells = rows.map((row) => visibleLength(row[index] ?? ''));
    return Math.max(visibleLength(column.header), ...(cells.length > 0 ? cells : [0]));
  });

  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, index) => pad(cell, widths[index] ?? 0, columns[index]?.align ?? 'left'))
      .join('  ')
      .trimEnd();

  const head = line(columns.map((column) => column.header));
  const rule = dim(widths.map((width) => '-'.repeat(width)).join('  '));

  return [head, rule, ...rows.map(line)].join('\n');
}
