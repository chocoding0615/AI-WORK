'use strict';

const INTERPRET_SYSTEM_PROMPT =
  'You are a personal/business expense analyst. You output ONLY a single JSON object matching ' +
  'the schema the user describes. No markdown, no code fences, no commentary. You must only ' +
  'reference the candidate_id values given to you — never invent new ones, never omit any, ' +
  'never invent or restate numbers (all amounts/dates are supplied by the caller and are ' +
  'already final — you must not recalculate them or state a different number). Never state ' +
  'from transaction history alone that something IS a subscription, never declare a cost ' +
  '"unnecessary", and never instruct the user to cancel anything without first asking them to ' +
  'verify. Always use tentative, verify-this language in Korean.';

// CODE has already decided WHAT the recurring pattern is (the candidate +
// its numbers). AI is only asked WHAT TO CHECK/DO — it never gets a chance
// to restate or alter numeric Truth, since we never read numeric fields
// back out of its response (see validateInterpretation / assembleResult).
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
    '- recommendedAction: one concrete Korean sentence describing what to verify or check next ' +
    '(e.g. check the account/app for this merchant, compare against known subscriptions), never ' +
    'an instruction to cancel without first confirming with the user.\n\n' +
    'Return strictly this JSON shape and nothing else:\n' +
    '{"candidates":[{"candidate_id":"<id>","interpretation":"<...>","recommendedAction":"<...>"}]}\n\n' +
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
      typeof c.recommendedAction !== 'string' || c.recommendedAction.trim() === ''
    ) {
      throw new Error(`AI_SCHEMA_INVALID: malformed candidate entry ${JSON.stringify(c)}`);
    }
    map.set(c.candidate_id, { interpretation: c.interpretation.trim(), recommendedAction: c.recommendedAction.trim() });
  }
  for (const id of expectedIds) {
    if (!map.has(id)) {
      throw new Error(`AI_SCHEMA_INVALID: missing entry for candidate_id ${id}`);
    }
  }
  return map;
}

// Assembles the final result using ONLY code-computed numbers (`candidates`)
// plus the two text fields read out of the validated AI response above.
function assembleResult(candidates, aiMap) {
  return candidates.map((c, idx) => {
    const ai = aiMap.get(`c${idx}`);
    return { ...c, interpretation: ai.interpretation, recommendedAction: ai.recommendedAction };
  });
}

function won(n) {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

function renderMarkdown({ summary, candidates }) {
  const lines = [];
  lines.push('# 반복 지출 탐지 리포트');
  lines.push('');
  lines.push(`- 분석 기간: ${summary.analyzedPeriod.start} ~ ${summary.analyzedPeriod.end}`);
  lines.push(`- 총 거래 수: ${summary.totalTransactions}건`);
  lines.push(`- 월 반복 지출 후보 수: ${summary.recurringCandidateCount}건`);
  lines.push(`- 월 평균 반복비: ${won(summary.averageMonthlyRecurringTotal)}`);
  lines.push(`- 연 환산 예상 반복비: ${won(summary.annualizedRecurringTotal)}`);
  lines.push('');

  lines.push('## 반복 지출 후보');
  if (candidates.length === 0) {
    lines.push('');
    lines.push('설정된 기준에서 월 반복 지출 후보가 발견되지 않았습니다.');
    return lines.join('\n');
  }

  candidates.forEach((c, idx) => {
    lines.push('');
    lines.push(`### ${idx + 1}. ${c.merchant}`);
    lines.push(`- 반복 개월 수: ${c.recurringMonths}개월`);
    lines.push(`- 주요 결제일: ${c.typicalPaymentDay}일 (범위: ${c.paymentDayRange.min}~${c.paymentDayRange.max}일)`);
    lines.push(`- 월별 금액: ${c.monthlyAmounts.map((m) => `${m.month} ${won(m.amount)}`).join(', ')}`);
    lines.push(`- 월 평균: ${won(c.averageMonthlyAmount)}`);
    lines.push(`- 최근 월 금액: ${won(c.latestMonthAmount)}`);
    lines.push(`- 누적 지출: ${won(c.totalAmount)}`);
    lines.push(`- 연 환산: ${won(c.annualizedAmount)}`);
    lines.push(`- AI 확인사항: ${c.interpretation}`);
    lines.push(`- 추천 Action: ${c.recommendedAction}`);
  });

  return lines.join('\n');
}

module.exports = {
  INTERPRET_SYSTEM_PROMPT,
  buildInterpretPrompt,
  validateInterpretation,
  assembleResult,
  renderMarkdown,
  won,
};
