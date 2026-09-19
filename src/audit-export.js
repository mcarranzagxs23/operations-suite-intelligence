/**
 * Turning an on-screen audit table into a file someone else can read.
 *
 * Three decisions shape this module, and all three exist because a CSV is not
 * an inert text file — it is a document that a spreadsheet program interprets.
 *
 * First, a cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage
 * return is treated as a formula by Excel, LibreOffice and Google Sheets. An
 * audit row carries names an administrator typed, so a workspace called
 * `=cmd|...` would become executable content the moment the reviewer opens the
 * export. Every such cell is prefixed with an apostrophe, which those programs
 * strip on display and never execute. Quoting alone does not prevent this:
 * the formula check happens after the CSV parser removes the quotes.
 *
 * Second, the export carries exactly the columns the console already renders.
 * Exporting must never become a way to obtain a field the screen withholds —
 * otherwise the read authority enforced by Firestore Rules would end at the
 * download button.
 *
 * Third, the file opens correctly in Spanish. A byte-order mark is written so
 * Excel reads it as UTF-8 instead of the system codepage, which is the
 * difference between `Diseño` and `DiseÃ±o` for a reviewer on Windows.
 */

/** Characters a spreadsheet reads as the start of a formula. */
const FORMULA_LEAD_CHARACTERS = Object.freeze(['=', '+', '-', '@']);
const TAB_CHARACTER_CODE = 9;
const CARRIAGE_RETURN_CODE = 13;

/** RFC 4180 uses CRLF, and Excel on Windows is unforgiving about it. */
const ROW_SEPARATOR = '\r\n';

/**
 * Excel needs this to read the file as UTF-8 rather than the system codepage.
 * It is built from its code point rather than written as a literal, because an
 * invisible character pasted into a source file is a defect nobody can see in
 * a diff.
 */
const BYTE_ORDER_MARK_CODE = 0xfeff;
export const UTF8_BOM = String.fromCharCode(BYTE_ORDER_MARK_CODE);

/**
 * Neutralize a value a spreadsheet would otherwise execute.
 *
 * The apostrophe is not part of the data; it is the escape those programs
 * understand. A reviewer sees the original text.
 */
export function neutralizeFormula(value) {
  if (value === '') return '';
  const firstCharacter = value.charAt(0);
  const firstCode = value.charCodeAt(0);
  const isFormulaLead = FORMULA_LEAD_CHARACTERS.includes(firstCharacter)
    || firstCode === TAB_CHARACTER_CODE
    || firstCode === CARRIAGE_RETURN_CODE;

  return isFormulaLead ? `'${value}` : value;
}

/**
 * Render one cell as RFC 4180 requires.
 *
 * Nothing is dropped and nothing is truncated: a value that cannot be
 * represented would be a silent hole in an audit record, which is worse than
 * an awkward cell.
 */
export function toCsvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = neutralizeFormula(text);

  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Build a complete CSV document from a column definition and a row list.
 *
 * `columns` is an ordered list of `{ key, label }`. The order of the file is
 * the order of the array, never the key order of the first row, so a row with
 * a missing field produces an empty cell instead of shifting the whole table.
 */
export function buildCsv({ columns, rows }) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('csv-columns-required');
  }

  const header = columns.map((column) => toCsvCell(column.label)).join(',');
  const body = (Array.isArray(rows) ? rows : []).map((row) => (
    columns.map((column) => toCsvCell(row ? row[column.key] : '')).join(',')
  ));

  return `${UTF8_BOM}${[header, ...body].join(ROW_SEPARATOR)}${ROW_SEPARATOR}`;
}

/**
 * The columns of the audit export, in the order the console shows them.
 *
 * `resolveActor` and `resolveAction` are supplied by the caller because both
 * translations and person labels belong to the presentation layer. This module
 * stays pure so it can be tested without a browser or a dictionary.
 */
export function buildAuditCsv({ rows, t, resolveActor, resolveAction }) {
  const columns = [
    { key: 'createdAt', label: t('columnWhen') },
    { key: 'action', label: t('columnAction') },
    { key: 'scope', label: t('columnScope') },
    { key: 'actor', label: t('columnActor') },
    { key: 'targetType', label: t('columnTargetType') },
    { key: 'targetId', label: t('columnTarget') },
    { key: 'result', label: t('columnResult') },
  ];

  const exported = (Array.isArray(rows) ? rows : []).map((entry) => ({
    createdAt: entry.createdAt || '',
    action: resolveAction ? resolveAction(entry.action) : entry.action,
    scope: entry.scope || '',
    actor: resolveActor ? resolveActor(entry.actorUid) : entry.actorUid,
    targetType: entry.targetType || '',
    targetId: entry.targetId || '',
    result: entry.result || '',
  }));

  return buildCsv({ columns, rows: exported });
}

/**
 * A filename carrying the moment of the export.
 *
 * The timestamp is part of the name because two exports taken hours apart are
 * different evidence, and a reviewer holding both files needs to tell them
 * apart without opening either.
 */
export function auditExportFilename(now = new Date()) {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `operations-suite-auditoria-${stamp}.csv`;
}
