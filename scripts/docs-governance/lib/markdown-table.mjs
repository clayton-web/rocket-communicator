/**
 * GFM table row splitting that is safe for the decision register.
 *
 * A register row is a single ~4,900-character line, so the only structural risk is
 * mis-splitting cells. GFM resolves cell boundaries *before* inline parsing, so a
 * backslash escape is the only way to put a literal pipe inside a cell (D155 relies on
 * this: `kept \| assigned`). Backticks do not protect a pipe.
 *
 * A plain `split('|')` therefore corrupts D155, and a lookbehind such as `(?<!\\)\|`
 * still misreads a pipe that follows an escaped backslash. This scanner consumes
 * backslash escapes explicitly instead.
 */

/** Splits one raw table line into its cells, honouring backslash escapes. */
export function splitTableRow(line) {
  const cells = [];
  let current = '';

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '\\' && i + 1 < line.length) {
      // Keep the escape sequence verbatim; unescaping is a normalization concern.
      current += char + line[i + 1];
      i += 1;
      continue;
    }

    if (char === '|') {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }
  cells.push(current);

  // A pipe-delimited row yields empty leading and trailing fragments.
  if (cells.length >= 2 && cells[0].trim() === '' && cells[cells.length - 1].trim() === '') {
    return cells.slice(1, -1).map((cell) => cell.trim());
  }
  return cells.map((cell) => cell.trim());
}

/** True for a GFM delimiter row such as `| ---- | ---- |`. */
export function isDelimiterRow(line) {
  if (!line.trimStart().startsWith('|')) return false;
  return splitTableRow(line).every((cell) => /^:?-{1,}:?$/.test(cell));
}

/** True for any line that opens a table row. */
export function isTableRow(line) {
  return line.trimStart().startsWith('|');
}
