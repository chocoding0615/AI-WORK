'use strict';

// Minimal RFC4180-ish CSV parser: handles quoted fields, escaped quotes ("")
// and embedded commas/newlines inside quotes. No external dependency —
// this is the entire parsing surface #001 needs.
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

  // Drop fully-empty trailing rows (e.g. trailing newline at EOF).
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// Validate + normalize raw CSV rows into the Input Contract defined in
// docs/automations/001-customer-feedback-action.md.
//
// Rule for blank reviews: a row whose `review` cell is empty/whitespace-only
// is skipped (not rejected) — this is the simplest consistent rule the
// contract allows ("blank reviews ignored or rejected according to the
// simplest consistent rule").
//
// Rule for the 300-review limit: it applies to USABLE (non-blank) reviews,
// not raw row count — matching the contract's "Maximum 300 reviews" wording.
function validateInput(rows, { maxReviews = 300 } = {}) {
  if (!rows || rows.length === 0) {
    return { ok: false, code: 'EMPTY_FILE', message: 'CSV file has no rows.' };
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const reviewIdx = header.indexOf('review');
  if (reviewIdx === -1) {
    return {
      ok: false,
      code: 'MISSING_REVIEW_COLUMN',
      message: `Required column "review" not found. Header was: [${header.join(', ')}]`,
    };
  }
  const ratingIdx = header.indexOf('rating');
  const productIdx = header.indexOf('product');
  const dateIdx = header.indexOf('date');

  const dataRows = rows.slice(1);
  const usable = [];
  const rowIssues = [];
  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 2; // row 1 is the header
    const r = dataRows[i];
    const review = (r[reviewIdx] || '').trim();
    if (review.length === 0) {
      if (!r.every((c) => String(c == null ? '' : c).trim() === '')) {
        rowIssues.push(`${rowNumber}행: review 값이 비어 있어 건너뜀`);
      }
      continue;
    }
    usable.push({
      rowNumber,
      review,
      rating: ratingIdx !== -1 ? (r[ratingIdx] || '').trim() || null : null,
      product: productIdx !== -1 ? (r[productIdx] || '').trim() || null : null,
      date: dateIdx !== -1 ? (r[dateIdx] || '').trim() || null : null,
    });
  }

  if (usable.length === 0) {
    return {
      ok: false,
      code: 'EMPTY_REVIEWS',
      message: 'No usable (non-blank) reviews found in CSV.',
    };
  }

  if (usable.length > maxReviews) {
    return {
      ok: false,
      code: 'OVER_LIMIT',
      message: `Input has ${usable.length} usable reviews, exceeding the maximum of ${maxReviews}.`,
    };
  }

  const reviews = usable.map((r, idx) => ({ id: idx, ...r }));

  return {
    ok: true,
    reviews,
    blankSkipped: dataRows.length - usable.length,
    rowIssues,
  };
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

module.exports = { parseCsv, validateInput, escapeCsvValue, toCsv };
