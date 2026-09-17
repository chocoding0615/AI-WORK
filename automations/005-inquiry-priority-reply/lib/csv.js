'use strict';

// RFC4180-ish CSV parser: handles quoted fields, escaped quotes ("") and
// embedded commas/newlines inside quotes. Never a plain split(',').
// Strips a leading UTF-8 BOM (Excel-saved CSVs and our own sample download
// both carry one) — left in place it would corrupt the first header name.
function parseCsv(text) {
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

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// Quote a value only when it needs it, doubling embedded quotes.
function escapeCsvValue(value) {
  const s = String(value == null ? '' : value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Result CSV for download: UTF-8 BOM + CRLF so Excel on Windows opens the
// Korean text correctly (same convention as the sample file).
function toCsv(headerRow, dataRows) {
  const lines = [headerRow, ...dataRows].map((r) => r.map(escapeCsvValue).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { parseCsv, escapeCsvValue, toCsv };
