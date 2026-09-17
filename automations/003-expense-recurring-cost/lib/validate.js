'use strict';

const { SchemaError, resolveColumns, parseDate, parseNumber } = require('./schema');

const MAX_ROWS = 10000;
const MIN_DISTINCT_MONTHS = 3;

// Validate + normalize raw CSV rows into the Input Contract:
// { date, merchant, amount } records. Fails loudly (throws SchemaError) on
// the first problem found — this is a v1 MVP, not a batch error-collection UX.
function validateAndNormalize(rows, { maxRows = MAX_ROWS } = {}) {
  if (!rows || rows.length === 0) {
    throw new SchemaError('EMPTY_FILE', 'CSV 파일에 내용이 없습니다.');
  }

  const header = rows[0];
  const columns = resolveColumns(header);
  const headerLabels = {
    date: header[columns.date].trim(),
    merchant: header[columns.merchant].trim(),
    amount: header[columns.amount].trim(),
  };

  const dataRows = rows.slice(1);
  if (dataRows.length > maxRows) {
    throw new SchemaError('TOO_MANY_ROWS', `데이터 행이 ${dataRows.length}개로 최대 ${maxRows}개를 초과했습니다.`);
  }

  const records = [];
  const rowIssues = [];
  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 2; // +1 for 0-index, +1 because row 1 is the header
    const r = dataRows[i];

    // A fully blank row (all cells empty) is a harmless formatting artifact,
    // not a data row — skip it silently.
    if (r.every((c) => String(c == null ? '' : c).trim() === '')) continue;

    // Any other per-row problem is reported with its row number and the row
    // is skipped — it must not stop the rest of a large, mostly-valid file
    // from being analyzed.
    try {
      const merchant = String(r[columns.merchant] == null ? '' : r[columns.merchant]).trim();
      if (merchant === '') {
        throw new SchemaError('INVALID_MERCHANT', `${rowNumber}행의 \`${headerLabels.merchant}\` 값이 비어 있습니다.`);
      }

      const date = parseDate(r[columns.date], rowNumber);

      const amount = parseNumber(r[columns.amount], rowNumber, headerLabels.amount);
      if (amount < 0) {
        throw new SchemaError('NEGATIVE_AMOUNT', `${rowNumber}행의 \`${headerLabels.amount}\` 값 "${r[columns.amount]}"이 음수입니다.`);
      }

      records.push({ date, merchant, amount });
    } catch (e) {
      if (e instanceof SchemaError) {
        rowIssues.push(`${e.message} — 건너뜀`);
        continue;
      }
      throw e;
    }
  }

  if (records.length === 0) {
    throw new SchemaError('EMPTY_FILE', '분석할 수 있는 데이터 행이 없습니다.');
  }

  const distinctMonths = new Set(records.map((r) => r.date.slice(0, 7)));
  if (distinctMonths.size < MIN_DISTINCT_MONTHS) {
    throw new SchemaError(
      'INSUFFICIENT_MONTH_RANGE',
      `CSV 데이터가 ${distinctMonths.size}개월치뿐입니다. 월 반복 지출을 판단하려면 최소 ${MIN_DISTINCT_MONTHS}개월 이상의 거래 데이터가 필요합니다.`
    );
  }

  return { records, headerLabels, rowIssues };
}

module.exports = { validateAndNormalize, MAX_ROWS, MIN_DISTINCT_MONTHS };
