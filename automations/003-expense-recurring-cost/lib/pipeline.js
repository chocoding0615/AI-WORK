'use strict';

const { toCsv } = require('./csv');

const INTERPRET_SYSTEM_PROMPT =
  'You are a personal/business expense analyst. You output ONLY a single JSON object matching ' +
  'the schema the user describes. No markdown, no code fences, no commentary. You must only ' +
  'reference the candidate_id values given to you — never invent new ones, never omit any, ' +
  'never invent or restate numbers (all amounts/dates are supplied by the caller and are ' +
  'already final — you must not recalculate them or state a different number). Never state ' +
  'from transaction history alone that something IS a subscription, never declare a cost ' +
  '"unnecessary", and never instruct the user to cancel anything without first asking them to ' +
  'verify. Always use tentative, verify-this language in Korean.';

// CODE has already decided WHAT the recurring pattern is, its confidence
// label, and its execution status ("검토 필요" — always, since actual usage
// is never in the input). AI is only asked WHAT TO CHECK/DO — it never gets
// a chance to restate or alter numeric Truth, since we never read numeric
// fields back out of its response (see validateInterpretation / assembleResult).
function buildInterpretPrompt(candidates) {
  const payload = candidates.map((c, idx) => ({
    candidate_id: `c${idx}`,
    merchant: c.merchant,
    recurringMonths: c.recurringMonths,
    typicalPaymentDay: c.typicalPaymentDay,
    paymentDayRange: c.paymentDayRange,
    monthlyAmounts: c.monthlyAmounts,
    averageMonthlyAmount: c.averageMonthlyAmount,
    totalAmount: c.totalAmount,
    latestMonthAmount: c.latestMonthAmount,
    annualizedAmount: c.annualizedAmount,
    amountVaries: c.amountVaries,
    confidence: c.confidence,
  }));

  return (
    'Below are monthly recurring-payment candidates already detected and computed by ' +
    'deterministic code (same merchant, repeating on a similar day of month across 3+ months). ' +
    'Do not recompute or restate the numbers — they are given only so you can interpret them.\n\n' +
    'For each candidate, write in Korean:\n' +
    '- interpretation: 1-2 Korean tentative sentences noting this looks like a recurring monthly ' +
    'charge and what to check (currently in use? a duplicate service or contract? a cheaper plan ' +
    'available?). Do not assert it is a subscription or unnecessary — only that it repeats and is ' +
    'worth verifying.\n' +
    '- checkItems: 1-3 short Korean phrases, each a specific thing to verify (e.g. "최근 앱/계정 ' +
    '로그인 이력", "동일 서비스 중복 가입 여부", "더 저렴한 요금제 존재 여부") — phrases, not full ' +
    'sentences.\n' +
    '- recommendedAction: one concrete Korean sentence describing what to verify or check next ' +
    '(e.g. check the account/app for this merchant, compare against known subscriptions), never ' +
    'an instruction to cancel without first confirming with the user.\n\n' +
    'Return strictly this JSON shape and nothing else:\n' +
    '{"candidates":[{"candidate_id":"<id>","interpretation":"<...>","checkItems":["<...>"],"recommendedAction":"<...>"}]}\n\n' +
    'You must cover every candidate_id below exactly once, and no others.\n\n' +
    `CANDIDATES:\n${JSON.stringify(payload)}`
  );
}

function validateInterpretation(response, expectedIds) {
  if (!response || !Array.isArray(response.candidates)) {
    throw new Error('AI_SCHEMA_INVALID: candidates missing or not an array');
  }
  const map = new Map();
  for (const c of response.candidates) {
    if (
      typeof c.candidate_id !== 'string' ||
      typeof c.interpretation !== 'string' || c.interpretation.trim() === '' ||
      !Array.isArray(c.checkItems) || c.checkItems.length === 0 ||
      c.checkItems.some((x) => typeof x !== 'string' || x.trim() === '') ||
      typeof c.recommendedAction !== 'string' || c.recommendedAction.trim() === ''
    ) {
      throw new Error(`AI_SCHEMA_INVALID: malformed candidate entry ${JSON.stringify(c)}`);
    }
    map.set(c.candidate_id, {
      interpretation: c.interpretation.trim(),
      checkItems: c.checkItems.map((x) => x.trim()),
      recommendedAction: c.recommendedAction.trim(),
    });
  }
  for (const id of expectedIds) {
    if (!map.has(id)) {
      throw new Error(`AI_SCHEMA_INVALID: missing entry for candidate_id ${id}`);
    }
  }
  return map;
}

// Assembles the final result using ONLY code-computed numbers/labels
// (`candidates`, already carrying confidence/executionStatus/amountVaries)
// plus the text fields read out of the validated AI response above.
function assembleResult(candidates, aiMap) {
  return candidates.map((c, idx) => {
    const ai = aiMap.get(`c${idx}`);
    return {
      ...c,
      rank: idx + 1,
      interpretation: ai.interpretation,
      checkItems: ai.checkItems,
      recommendedAction: ai.recommendedAction,
    };
  });
}

function won(n) {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

// Plain text — safe to paste into Slack/KakaoTalk/email as-is.
function renderSummaryText({ summary, candidates, duplicateClusters }) {
  const lines = [];
  lines.push('[반복 지출 점검 요약]');
  lines.push(`분석 기간: ${summary.analyzedPeriod.start} ~ ${summary.analyzedPeriod.end}`);
  lines.push(`전체 지출 건수: ${summary.totalTransactions}건 / 전체 지출액: ${won(summary.totalAmount)}`);
  lines.push(`반복 결제 후보: ${summary.recurringCandidateCount}건`);
  lines.push(`반복 결제 추정 월 합계: ${won(summary.averageMonthlyRecurringTotal)} / 연간 합계: ${won(summary.annualizedRecurringTotal)}`);
  lines.push(`점검 가능한 예상 절감액: ${summary.potentialSavingsLabel} (실제 사용 여부가 입력에 없어 확정할 수 없음)`);
  lines.push('');

  lines.push('[반복 지출 후보 — 연 환산 금액 순]');
  if (candidates.length === 0) {
    lines.push('- 설정된 기준에서 월 반복 지출 후보가 발견되지 않았습니다.');
  } else {
    candidates.forEach((c) => {
      lines.push(`${c.rank}. [${c.confidence}] ${c.merchant} — 월 평균 ${won(c.averageMonthlyAmount)} / 연 환산 ${won(c.annualizedAmount)} (실행 상태: ${c.executionStatus})`);
      lines.push(`   반복 개월 수: ${c.recurringMonths}개월, 주요 결제일: ${c.typicalPaymentDay}일`);
      lines.push(`   확인 사항: ${c.interpretation}`);
      lines.push(`   확인 항목: ${c.checkItems.join(' / ')}`);
      lines.push(`   추천 행동: ${c.recommendedAction}`);
    });
  }

  if (duplicateClusters.length > 0) {
    lines.push('');
    lines.push('[중복/유사 결제처 묶음 — 코드 기준 이름 정규화]');
    duplicateClusters.forEach((names) => lines.push(`- ${names.join(' / ')}`));
  }

  return lines.join('\n');
}

const RESULT_CSV_HEADER = [
  '순위', '가맹점', '반복개월수', '주요결제일', '결제일범위', '월평균금액', '최근월금액',
  '연환산금액', '신뢰도', '금액변동여부', '실행상태', '확인사항(AI)', '확인항목', '추천행동',
];

function renderResultCsv(candidates) {
  const rows = candidates.map((c) => [
    c.rank,
    c.merchant,
    c.recurringMonths,
    c.typicalPaymentDay,
    `${c.paymentDayRange.min}~${c.paymentDayRange.max}일`,
    Math.round(c.averageMonthlyAmount),
    c.latestMonthAmount,
    Math.round(c.annualizedAmount),
    c.confidence,
    c.amountVaries ? 'Y' : '',
    c.executionStatus,
    c.interpretation,
    c.checkItems.join(' / '),
    c.recommendedAction,
  ]);
  return toCsv(RESULT_CSV_HEADER, rows);
}

module.exports = {
  INTERPRET_SYSTEM_PROMPT,
  buildInterpretPrompt,
  validateInterpretation,
  assembleResult,
  renderSummaryText,
  renderResultCsv,
  won,
};
