'use strict';

// Minimal RFC4180-ish CSV parser: handles quoted fields, escaped quotes ("")
// and embedded commas/newlines inside quotes. No external dependency.
// (Same parser shape as #001's — copied locally, not shared, per the
// "independent automation" rule: #002 owns its own CSV parsing.)
function parseCsv(text) {
  // Strip a leading UTF-8 BOM if present (e.g. from Excel-saved CSVs, or
  // our own example-CSV download which now writes one for Excel/Notepad
  // compatibility) — Buffer/String decoding does not strip it automatically,
  // and left in place it would corrupt the first header cell's name.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-empty trailing rows (e.g. trailing newline at EOF).
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

module.exports = { parseCsv };
