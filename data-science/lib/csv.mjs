/**
 * Small CSV reader/writer for the academic dataset.
 *
 * The synthetic source is produced by this project, but the parser still
 * handles RFC 4180 quotes so an authorized controlled export can use the same
 * ETL entry point without depending on a third-party package.
 */

function stringifyCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows, columns) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('CSV columns are required.');
  }
  const lines = [columns.map(stringifyCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => stringifyCell(row[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function fromCsv(text) {
  if (typeof text !== 'string' || text.trim() === '') return [];

  const records = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value !== '')) records.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (inQuotes) throw new Error('CSV contains an unterminated quoted value.');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    records.push(row);
  }
  if (records.length === 0) return [];

  const [headers, ...values] = records;
  if (headers.some((header) => header === '')) throw new Error('CSV contains an empty header.');
  if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate headers.');

  return values.map((value, rowIndex) => {
    if (value.length !== headers.length) {
      throw new Error(`CSV row ${rowIndex + 2} has ${value.length} values; expected ${headers.length}.`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, value[index]]));
  });
}
