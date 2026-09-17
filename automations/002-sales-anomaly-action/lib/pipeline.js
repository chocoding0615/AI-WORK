'use strict';

const TYPE_LABEL_KO = {
  SURGE: '급증',
  DROP: '급감',
  NEW_SURGE: '신규 급증',
  DROP_TO_ZERO: '제로 급감',
};

const INTERPRET_SYSTEM_PROMPT =
  'You are a sales data analyst. You output ONLY a single JSON object matching the schema ' +
  'the user describes. No markdown, no code fences, no commentary. You must only reference ' +
  'the anomaly_id values given to you — never invent new ones, never omit any, never invent ' +
  'or restate numbers (all sales/quantity figures are supplied by the caller and are already ' +
  'final — you must not recalculate, round differently, or state a different number). Never ' +
  'state an unverified cause as a confirmed fact — use tentative, investigate-this language.';

// CODE has already decided WHAT happened (the anomaly + its numbers). AI is
// only asked WHAT TO INVESTIGATE/DO — it is never given a chance to restate
// or alter numeric Truth, since we never read numeric fields back out of its
// response (see validateInterpretation / assembleResult below).
function buildInterpretPrompt(anomalies) {
  const payload = anomalies.map((a, idx) => ({
    anomaly_id: `a${idx}`,
    product: a.product,
    type: a.type,
    previousSales: a.previousSales,
    currentSales: a.currentSales,
    salesChange: a.salesChange,
    changeRatePercent: a.changeRate,
    previousQuantity: a.previousQuantity,
    currentQuantity: a.currentQuantity,
  }));

  return (
    'Below are sales anomalies already detected and computed by deterministic code ' +
    '(previous 7-day period vs current 7-day period, in KRW). Do not recompute or restate ' +
    'the numbers — they are given only so you can interpret them.\n\n' +
    'For each anomaly, write in Korean:\n' +
    '- interpretation: 1-2 Korean sentences on plausible causes to investigate for this change ' +
    '(e.g. promotion, stockout, seasonality, pricing, listing/channel issue, review/CS issue). ' +
    'Frame causes as possibilities to check, not confirmed facts.\n' +
    '- recommended_action: one concrete, specific Korean sentence describing what to check or do next.\n\n' +
    'Return strictly this JSON shape and nothing else:\n' +
    '{"anomalies":[{"anomaly_id":"<id>","interpretation":"<...>","recommended_action":"<...>"}]}\n\n' +
    'You must cover every anomaly_id below exactly once, and no others.\n\n' +
    `ANOMALIES:\n${JSON.stringify(payload)}`
  );
}

function validateInterpretation(response, expectedIds) {
  if (!response || !Array.isArray(response.anomalies)) {
    throw new Error('AI_SCHEMA_INVALID: anomalies missing or not an array');
  }
  const map = new Map();
  for (const a of response.anomalies) {
    if (
      typeof a.anomaly_id !== 'string' ||
      typeof a.interpretation !== 'string' || a.interpretation.trim() === '' ||
      typeof a.recommended_action !== 'string' || a.recommended_action.trim() === ''
    ) {
      throw new Error(`AI_SCHEMA_INVALID: malformed anomaly entry ${JSON.stringify(a)}`);
    }
    map.set(a.anomaly_id, { interpretation: a.interpretation.trim(), recommended_action: a.recommended_action.trim() });
  }
  for (const id of expectedIds) {
    if (!map.has(id)) {
      throw new Error(`AI_SCHEMA_INVALID: missing entry for anomaly_id ${id}`);
    }
  }
  return map;
}

// Assembles the final result using ONLY code-computed numbers (`anomalies`)
// plus the two text fields read out of the validated AI response above.
function assembleResult(anomalies, aiMap) {
  return anomalies.map((a, idx) => {
    const ai = aiMap.get(`a${idx}`);
    return { ...a, interpretation: ai.interpretation, recommendedAction: ai.recommended_action };
  });
}

function formatPercent(rate) {
  if (rate === null || rate === undefined) return 'N/A';
  const sign = rate > 0 ? '+' : '';
  return `${sign}${rate.toFixed(1)}%`;
}

function formatWon(n) {
  return `${n.toLocaleString('ko-KR')}원`;
}

function renderMarkdown({ periods, productsAnalyzed, anomalies }) {
  const lines = [];
  lines.push('# 매출 이상 탐지 리포트');
  lines.push('');
  lines.push(`- 이전 기간: ${periods.previous.start} ~ ${periods.previous.end}`);
  lines.push(`- 현재 기간: ${periods.current.start} ~ ${periods.current.end}`);
  lines.push(`- 분석 상품 수: ${productsAnalyzed}개`);
  lines.push(`- 이상 탐지 건수: ${anomalies.length}건`);

  if (anomalies.length > 0) {
    const counts = {};
    for (const a of anomalies) counts[a.type] = (counts[a.type] || 0) + 1;
    const byType = Object.keys(counts).map((t) => `${TYPE_LABEL_KO[t]} ${counts[t]}건`).join(', ');
    lines.push(`- 유형별: ${byType}`);
  }
  lines.push('');

  lines.push('## 이상 탐지 결과');
  if (anomalies.length === 0) {
    lines.push('');
    lines.push('설정된 기준에서 확인이 필요한 매출 변화가 발견되지 않았습니다.');
    return lines.join('\n');
  }

  anomalies.forEach((a, idx) => {
    lines.push('');
    lines.push(`### ${idx + 1}. ${a.product} — ${TYPE_LABEL_KO[a.type]}`);
    lines.push(`- 이전 7일 매출: ${formatWon(a.previousSales)}`);
    lines.push(`- 현재 7일 매출: ${formatWon(a.currentSales)}`);
    lines.push(`- 매출 변화: ${a.salesChange >= 0 ? '+' : ''}${formatWon(a.salesChange)} (${formatPercent(a.changeRate)})`);
    lines.push(`- 이전/현재 수량: ${a.previousQuantity.toLocaleString('ko-KR')} / ${a.currentQuantity.toLocaleString('ko-KR')}`);
    lines.push(`- AI 해석: ${a.interpretation}`);
    lines.push(`- 추천 확인/조치: ${a.recommendedAction}`);
  });

  return lines.join('\n');
}

module.exports = {
  TYPE_LABEL_KO,
  INTERPRET_SYSTEM_PROMPT,
  buildInterpretPrompt,
  validateInterpretation,
  assembleResult,
  renderMarkdown,
  formatPercent,
  formatWon,
};
