'use strict';

// CODE owns every input check for #006. Required headers are a fixed,
// exact Korean header set (no alias/fuzzy matching) — this MVP has one
// known input shape, not an arbitrary inventory export.
const REQUIRED_HEADERS = [
  '상품코드', '상품명', '현재재고', '예약재고', '기간출고량',
  '집계일수', '안전재고', '입고소요일', '최소발주수량', '매입단가', '공급처',
];

const MAX_ROWS = 300;

class InputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function trimmed(v) {
  return String(v == null ? '' : v).trim();
}

// Every required header must appear exactly once. Zero occurrences is a
// missing-column error; two or more is an ambiguous-header error — never
// silently pick the first match.
function validateHeaders(headerRow) {
  const present = headerRow.map(trimmed);
  const missing = REQUIRED_HEADERS.filter((h) => !present.includes(h));
  if (missing.length > 0) {
    throw new InputError(
      'MISSING_COLUMNS',
      `필수 열이 없습니다: ${missing.join(', ')} · 필요한 열 11개: ${REQUIRED_HEADERS.join(', ')}`
    );
  }
  const duplicated = REQUIRED_HEADERS.filter(
    (h) => present.filter((p) => p === h).length > 1
  );
  if (duplicated.length > 0) {
    throw new InputError(
      'AMBIGUOUS_COLUMNS',
      `다음 열이 중복되어 있어 판단할 수 없습니다: ${duplicated.join(', ')} · 각 열은 하나만 있어야 합니다.`
    );
  }
  const index = {};
  for (const h of REQUIRED_HEADERS) index[h] = present.indexOf(h);
  return index;
}

// Strict integer parse — no decimals, no thousands separators, no Korean
// numeral/unit parsing ("12개" must fail, not be silently interpreted).
function parseInt10(raw) {
  const s = trimmed(raw);
  if (!/^-?\d+$/.test(s)) return null;
  return Number(s);
}

// 매입단가 may carry decimals (원 단위 미만은 드물지만 배제하지 않는다).
function parseNonNegativeNumber(raw) {
  const s = trimmed(raw);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

// Validate + normalize raw CSV rows into records ready for lib/analysis.js.
// Per-row problems are collected as skip warnings (with row number + reason)
// so one bad row never stops the rest of a mostly-valid file from being
// analyzed — only file-level problems (missing columns, zero usable rows,
// over the row cap) are hard failures.
function validateAndNormalize(rows) {
  if (!rows || rows.length === 0) {
    throw new InputError('EMPTY_FILE', 'CSV 파일에 내용이 없습니다.');
  }

  const index = validateHeaders(rows[0]);
  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    throw new InputError('NO_DATA_ROWS', '헤더만 있고 재고 데이터가 없습니다. 최소 1건 이상 필요합니다.');
  }

  const records = [];
  const rowIssues = [];
  const seenCodes = new Set();

  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 2; // row 1 is the header
    const r = dataRows[i];

    if (r.every((c) => trimmed(c) === '')) continue;

    const get = (h) => (r[index[h]] == null ? '' : r[index[h]]);

    const code = trimmed(get('상품코드'));
    const name = trimmed(get('상품명'));
    if (code === '' || name === '') {
      rowIssues.push(`${rowNumber}행: 상품코드 또는 상품명이 비어 있어 건너뜀`);
      continue;
    }

    if (seenCodes.has(code)) {
      rowIssues.push(`${rowNumber}행: 상품코드 "${code}"가 이미 앞에서 사용되어(중복) 건너뜀`);
      continue;
    }

    const supplier = trimmed(get('공급처'));
    if (supplier === '') {
      rowIssues.push(`${rowNumber}행: 공급처가 비어 있어 건너뜀`);
      continue;
    }

    const fields = {
      currentStock: { raw: get('현재재고'), label: '현재재고' },
      reservedStock: { raw: get('예약재고'), label: '예약재고' },
      periodOutflow: { raw: get('기간출고량'), label: '기간출고량' },
      periodDays: { raw: get('집계일수'), label: '집계일수' },
      safetyStock: { raw: get('안전재고'), label: '안전재고' },
      leadTimeDays: { raw: get('입고소요일'), label: '입고소요일' },
      minOrderQty: { raw: get('최소발주수량'), label: '최소발주수량' },
    };

    let badField = null;
    const parsedInts = {};
    for (const key of Object.keys(fields)) {
      const { raw, label } = fields[key];
      const n = parseInt10(raw);
      if (n === null) {
        badField = `${rowNumber}행: \`${label}\` 값 "${raw}"을 숫자(정수)로 읽을 수 없어 건너뜀`;
        break;
      }
      if (n < 0) {
        badField = `${rowNumber}행: \`${label}\` 값 ${n}이 음수여서 건너뜀`;
        break;
      }
      parsedInts[key] = n;
    }
    if (badField) {
      rowIssues.push(badField);
      continue;
    }

    const unitCost = parseNonNegativeNumber(get('매입단가'));
    if (unitCost === null) {
      rowIssues.push(`${rowNumber}행: \`매입단가\` 값 "${get('매입단가')}"을 0 이상의 숫자로 읽을 수 없어 건너뜀`);
      continue;
    }

    if (parsedInts.periodDays <= 0) {
      rowIssues.push(`${rowNumber}행: 집계일수가 ${parsedInts.periodDays}(이)라 출고량 집계 기간으로 사용할 수 없어 건너뜀`);
      continue;
    }
    if (parsedInts.minOrderQty <= 0) {
      rowIssues.push(`${rowNumber}행: 최소발주수량이 ${parsedInts.minOrderQty}(이)라 발주 단위로 사용할 수 없어 건너뜀`);
      continue;
    }
    // 입고소요일 0은 유효(당일 입고). 음수만 오류.
    // (already rejected by the shared negative-check above.)

    seenCodes.add(code);
    records.push({
      rowNumber,
      code,
      name,
      supplier,
      currentStock: parsedInts.currentStock,
      reservedStock: parsedInts.reservedStock,
      periodOutflow: parsedInts.periodOutflow,
      periodDays: parsedInts.periodDays,
      safetyStock: parsedInts.safetyStock,
      leadTimeDays: parsedInts.leadTimeDays,
      minOrderQty: parsedInts.minOrderQty,
      unitCost,
    });
  }

  if (records.length === 0) {
    throw new InputError('NO_USABLE_ROWS', '분석할 수 있는 상품이 없습니다. 필수 값이 채워진 행이 필요한지 확인해주세요.');
  }

  // MAX_ROWS is enforced by the caller (lib/core.js), matching #005's
  // pattern of checking the row cap once at orchestration level.
  return { records, rowIssues };
}

module.exports = { REQUIRED_HEADERS, MAX_ROWS, InputError, validateHeaders, validateAndNormalize };
