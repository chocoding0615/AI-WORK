'use strict';

// CODE-owned, approved column aliases. No fuzzy/semantic matching — a header
// cell must match one of these exactly (after whitespace-trim + lowercasing,
// which is a no-op on Korean text so it only affects the English aliases).
const CANONICAL_ALIASES = {
  date: ['date', '날짜', '일자', '결제일', '거래일'],
  merchant: ['merchant', '가맹점', '가맹점명', '거래처', '사용처'],
  amount: ['amount', '금액', '결제금액', '사용금액', '출금액'],
};

const FIELD_ORDER = ['date', 'merchant', 'amount'];

class SchemaError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function normalize(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

// Each canonical field must resolve to exactly one CSV column: zero matches
// is a missing-column error, two-or-more is an ambiguous-column error. Never
// silently pick one.
function resolveColumns(headerRow) {
  const normalizedHeader = headerRow.map(normalize);
  const columns = {};

  for (const field of FIELD_ORDER) {
    const aliasSet = new Set(CANONICAL_ALIASES[field].map(normalize));
    const matches = [];
    normalizedHeader.forEach((h, idx) => {
      if (aliasSet.has(h)) matches.push(idx);
    });

    if (matches.length === 0) {
      throw new SchemaError(
        'MISSING_COLUMN',
        `\`${field}\`에 해당하는 컬럼을 찾을 수 없습니다. 지원 컬럼: ${CANONICAL_ALIASES[field].join(', ')}`
      );
    }
    if (matches.length > 1) {
      const names = matches.map((idx) => headerRow[idx].trim()).join(', ');
      throw new SchemaError(
        'AMBIGUOUS_COLUMN',
        `\`${field}\`에 해당하는 컬럼이 여러 개 있어 판단할 수 없습니다 (${names}). 하나만 남겨주세요.`
      );
    }
    columns[field] = matches[0];
  }

  return columns;
}

// Accept a few harmless date separator variants (formatting difference, not
// semantic guessing) and reject anything else, including dates that don't
// actually exist on the calendar.
const DATE_PATTERNS = [
  /^(\d{4})-(\d{2})-(\d{2})$/,
  /^(\d{4})\/(\d{2})\/(\d{2})$/,
  /^(\d{4})\.(\d{2})\.(\d{2})$/,
];

function parseDate(raw, rowNumber) {
  const trimmed = String(raw == null ? '' : raw).trim();
  let m = null;
  for (const pattern of DATE_PATTERNS) {
    m = trimmed.match(pattern);
    if (m) break;
  }
  if (!m) {
    throw new SchemaError(
      'INVALID_DATE',
      `${rowNumber}행의 날짜 값 "${raw}"을 읽을 수 없습니다. YYYY-MM-DD 형식이어야 합니다.`
    );
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const epochMs = Date.UTC(year, month - 1, day);
  const check = new Date(epochMs);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new SchemaError('INVALID_DATE', `${rowNumber}행의 날짜 값 "${raw}"은 존재하지 않는 날짜입니다.`);
  }
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return iso;
}

// Strips thousands-separator commas only — no Korean numeral/unit parsing.
function parseNumber(raw, rowNumber, fieldLabel) {
  const trimmed = String(raw == null ? '' : raw).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new SchemaError(
      'INVALID_NUMBER',
      `${rowNumber}행의 \`${fieldLabel}\` 값 "${raw}"을 숫자로 읽을 수 없습니다.`
    );
  }
  return Number(trimmed);
}

module.exports = { CANONICAL_ALIASES, SchemaError, resolveColumns, parseDate, parseNumber, normalize };
