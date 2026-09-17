'use strict';

// CODE owns every number and every priority decision in #005. The AI only
// writes text (분류/감정/다음 행동/답변 초안) — it never computes a score,
// never reorders results, never changes a count.

const REQUIRED_HEADERS = ['접수일', '고객명', '채널', '주문번호', '문의내용', '현재상태', '담당자메모'];

const URGENT_KEYWORDS = [
  '환불', '취소', '파손', '불량', '오배송', '누락', '고장', '결제오류', '중복결제',
  '법적', '소비자원', '신고', '고발', '항의', '최악', '사기', '화가', '분노', '실망',
];
const HIGH_KEYWORDS = [
  '지연', '아직', '언제', '미배송', '교환', '반품', '재발송', '연락', '확인 부탁',
  '급하', '빨리', '문제', '안 왔', '안왔', '오류',
];

const STATUS_OPEN = ['미처리', '접수', '대기', '신규'];
const STATUS_PROGRESS = ['처리중', '진행중', '확인중'];
const STATUS_DONE = ['완료', '종료', '처리완료', '답변완료'];

const GRADE_URGENT = '긴급';
const GRADE_HIGH = '높음';
const GRADE_NORMAL = '보통';
const GRADE_DONE = '완료';

class InputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(raw) {
  const m = String(raw == null ? '' : raw).trim().match(DATE_RE);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return { iso: `${m[1]}-${m[2]}-${m[3]}`, day: Math.floor(ms / 86400000) };
}

function statusGroup(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (STATUS_DONE.some((k) => s.includes(k))) return 'done';
  if (STATUS_PROGRESS.some((k) => s.includes(k))) return 'progress';
  if (STATUS_OPEN.some((k) => s.includes(k))) return 'open';
  return 'open'; // unknown status is treated as not-yet-handled
}

function matchedKeywords(text, list) {
  return list.filter((k) => text.includes(k));
}

// Validate headers first so a wrong file fails with the exact missing names.
function validateHeaders(headerRow) {
  const present = headerRow.map((h) => String(h == null ? '' : h).trim());
  const missing = REQUIRED_HEADERS.filter((h) => !present.includes(h));
  if (missing.length > 0) {
    throw new InputError(
      'MISSING_COLUMNS',
      `필수 열이 없습니다: ${missing.join(', ')} · 필요한 열 7개: ${REQUIRED_HEADERS.join(', ')}`
    );
  }
  const index = {};
  for (const h of REQUIRED_HEADERS) index[h] = present.indexOf(h);
  return index;
}

function validateAndNormalize(rows) {
  if (!rows || rows.length === 0) {
    throw new InputError('EMPTY_FILE', 'CSV 파일에 내용이 없습니다.');
  }
  const index = validateHeaders(rows[0]);
  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    throw new InputError('NO_DATA_ROWS', '헤더만 있고 문의 데이터가 없습니다. 최소 1건 이상 필요합니다.');
  }

  const records = [];
  const rowIssues = [];

  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 2; // row 1 is the header
    const r = dataRows[i];

    if (r.every((c) => String(c == null ? '' : c).trim() === '')) continue;

    if (r.length < REQUIRED_HEADERS.length) {
      rowIssues.push(`${rowNumber}행: 열 개수가 ${r.length}개로 부족합니다(필요 ${REQUIRED_HEADERS.length}개). 건너뜀`);
      continue;
    }

    const content = String(r[index['문의내용']] == null ? '' : r[index['문의내용']]).trim();
    if (content === '') {
      rowIssues.push(`${rowNumber}행: 문의내용이 비어 있어 건너뜀`);
      continue;
    }

    const rawDate = String(r[index['접수일']] == null ? '' : r[index['접수일']]).trim();
    const parsed = parseDate(rawDate);
    if (!parsed) {
      rowIssues.push(`${rowNumber}행: 접수일 "${rawDate}"이 YYYY-MM-DD 형식이 아니어서 경과일 계산에서 제외`);
    }

    records.push({
      rowNumber,
      receivedAt: parsed ? parsed.iso : rawDate,
      receivedDay: parsed ? parsed.day : null,
      customer: String(r[index['고객명']] || '').trim(),
      channel: String(r[index['채널']] || '').trim(),
      orderNo: String(r[index['주문번호']] || '').trim(),
      content,
      status: String(r[index['현재상태']] || '').trim(),
      note: String(r[index['담당자메모']] || '').trim(),
    });
  }

  if (records.length === 0) {
    throw new InputError('NO_USABLE_ROWS', '분석할 수 있는 문의가 없습니다. 문의내용이 채워진 행이 필요한지 확인해주세요.');
  }

  return { records, rowIssues };
}

// Deterministic priority score. The anchor for "how long has this been
// waiting" is the latest 접수일 in the file, not the wall clock, so the same
// CSV always produces the same scores.
function scoreRecords(records) {
  const days = records.map((r) => r.receivedDay).filter((d) => d !== null);
  const anchorDay = days.length > 0 ? Math.max(...days) : null;

  return records.map((r, idx) => {
    const haystack = `${r.content} ${r.note}`;
    const urgentHits = matchedKeywords(haystack, URGENT_KEYWORDS);
    const highHits = matchedKeywords(haystack, HIGH_KEYWORDS);
    const group = statusGroup(r.status);
    const elapsedDays = anchorDay !== null && r.receivedDay !== null ? anchorDay - r.receivedDay : 0;

    let score = 10;
    const reasons = [];

    if (urgentHits.length > 0) {
      score += 40;
      reasons.push(`긴급 신호 키워드: ${urgentHits.join(', ')}`);
    }
    if (highHits.length > 0) {
      score += 20;
      reasons.push(`주의 신호 키워드: ${highHits.join(', ')}`);
    }
    if (group === 'open') {
      score += 20;
      reasons.push(`현재상태 "${r.status || '미기재'}" — 아직 처리되지 않음`);
    } else if (group === 'progress') {
      score += 8;
      reasons.push(`현재상태 "${r.status}" — 처리 진행 중`);
    } else {
      score -= 15;
      reasons.push(`현재상태 "${r.status}" — 처리 완료`);
    }

    const elapsedBonus = Math.min(Math.max(elapsedDays, 0) * 2, 20);
    if (elapsedBonus > 0) {
      score += elapsedBonus;
      reasons.push(`접수 후 ${elapsedDays}일 경과`);
    }

    score = Math.max(0, Math.min(100, score));

    let grade;
    if (group === 'done') grade = GRADE_DONE;
    else if (score >= 70) grade = GRADE_URGENT;
    else if (score >= 45) grade = GRADE_HIGH;
    else grade = GRADE_NORMAL;

    return {
      ...r,
      id: idx,
      score,
      grade,
      elapsedDays,
      statusGroup: group,
      signals: { urgent: urgentHits, high: highHits },
      reasons,
    };
  });
}

function sortByPriority(scored) {
  // Already-handled inquiries sink below everything that still needs work —
  // this is a "what do I do next" list, so a 완료 건 must never take a TOP 5
  // slot. Within each group: highest score first, ties broken by oldest
  // 접수일, then file order — fully deterministic.
  return [...scored].sort((a, b) => {
    const aDone = a.statusGroup === 'done' ? 1 : 0;
    const bDone = b.statusGroup === 'done' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (b.score !== a.score) return b.score - a.score;
    const ad = a.receivedDay === null ? Number.MAX_SAFE_INTEGER : a.receivedDay;
    const bd = b.receivedDay === null ? Number.MAX_SAFE_INTEGER : b.receivedDay;
    if (ad !== bd) return ad - bd;
    return a.id - b.id;
  });
}

function computeSummary(scored) {
  return {
    total: scored.length,
    urgent: scored.filter((r) => r.grade === GRADE_URGENT).length,
    high: scored.filter((r) => r.grade === GRADE_HIGH).length,
    open: scored.filter((r) => r.statusGroup !== 'done').length,
    done: scored.filter((r) => r.statusGroup === 'done').length,
  };
}

module.exports = {
  REQUIRED_HEADERS,
  InputError,
  validateHeaders,
  validateAndNormalize,
  scoreRecords,
  sortByPriority,
  computeSummary,
  GRADE_URGENT,
  GRADE_HIGH,
  GRADE_NORMAL,
  GRADE_DONE,
};
