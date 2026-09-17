'use strict';

const { SchemaError, resolveColumns, parseDate, parseNumber } = require('./schema');

const MAX_ROWS = 10000;

// Validate + normalize raw CSV rows into the Input Contract:
// { date, product, sales, quantity } records. Fails loudly (throws
// SchemaError) on the first problem found — this is a v1 MVP, not a
// batch error-collection UX.
function validateAndNormalize(rows, { maxRows = MAX_ROWS } = {}) {
  if (!rows || rows.length === 0) {
    throw new SchemaError('EMPTY_FILE', 'CSV 파일에 내용이 없습니다.');
  }

  const header = rows[0];
  const columns = resolveColumns(header);
  const headerLabels = {
    date: header[columns.date].trim(),
    product: header[columns.product].trim(),
    sales: header[columns.sales].trim(),
    quantity: header[columns.quantity].trim(),
  };

  const dataRows = rows.slice(1);
  if (dataRows.length > maxRows) {
    throw new SchemaError('TOO_MANY_ROWS', `데이터 행이 ${dataRows.length}개로 최대 ${maxRows}개를 초과했습니다.`);
  }

  const records = [];
  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 2; // +1 for 0-index, +1 because row 1 is the header
    const r = dataRows[i];

    // A fully blank row (all cells empty) is a harmless formatting artifact
    // (e.g. a trailing blank line), not a data row — skip it, don't fail on it.
    if (r.every((c) => String(c == null ? '' : c).trim() === '')) continue;

    const product = String(r[columns.product] == null ? '' : r[columns.product]).trim();
    if (product === '') {
      throw new SchemaError('INVALID_PRODUCT', `${rowNumber}행의 \`${headerLabels.product}\` 값이 비어 있습니다.`);
    }

    const date = parseDate(r[columns.date], rowNumber);

    const sales = parseNumber(r[columns.sales], rowNumber, headerLabels.sales);
    if (sales < 0) {
      throw new SchemaError('NEGATIVE_SALES', `${rowNumber}행의 \`${headerLabels.sales}\` 값 "${r[columns.sales]}"이 음수입니다.`);
    }

    const quantity = parseNumber(r[columns.quantity], rowNumber, headerLabels.quantity);
    if (quantity < 0) {
      throw new SchemaError('NEGATIVE_QUANTITY', `${rowNumber}행의 \`${headerLabels.quantity}\` 값 "${r[columns.quantity]}"이 음수입니다.`);
    }

    records.push({ date, product, sales, quantity });
  }

  if (records.length === 0) {
    throw new SchemaError('EMPTY_FILE', '분석할 수 있는 데이터 행이 없습니다.');
  }

  return { records, headerLabels };
}

module.exports = { validateAndNormalize, MAX_ROWS };
