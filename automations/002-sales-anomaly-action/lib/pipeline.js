'use strict';

const { toCsv } = require('./csv');
const {
  buildDetectionBasis,
  SURGE_THRESHOLD_RATE,
  MIN_MAX_SALES,
  MIN_ABS_CHANGE,
  NEW_OR_ZERO_THRESHOLD,
} = require('./analysis');

const TYPE_LABEL_KO = {
  SURGE: '급증',
  DROP: '급감',
  NEW_SURGE: '신규 급증',
  DROP_TO_ZERO: '제로 급감',
};

const ANALYSIS_BASIS_NOTE =
  `최근 7일(현재 기간)과 그 직전 7일(이전 기간)의 상품별 매출 합계를 비교합니다. ` +
  `변동률이 ±${SURGE_THRESHOLD_RATE}% 이상이면서 두 기간 중 큰 쪽 매출이 ${MIN_MAX_SALES.toLocaleString('ko-KR')}원 이상, ` +
  `절대 변화액이 ${MIN_ABS_CHANGE.toLocaleString('ko-KR')}원 이상인 경우에만 이상으로 판단합니다. ` +
  `이전 기간 매출이 0원인데 현재 ${NEW_OR_ZERO_THRESHOLD.toLocaleString('ko-KR')}원 이상이면 "신규 급증", ` +
  `반대로 0원이 되면 "제로 급감"으로 별도 분류합니다. 두 기간 중 어느 한쪽도 매출이 없는 상품은 ` +
  `비교 대상에서 제외됩니다.`;

const INTERPRET_SYSTEM_PROMPT =
  'You are a sales data analyst. You output ONLY a single JSON object matching the schema ' +
  'the user describes. No markdown, no code fences, no commentary. You must only reference ' +
  'the anomaly_id values given to you — never invent new ones, never omit any, never invent ' +
  'or restate numbers (all sales/quantity figures are supplied by the caller and are already ' +
  'final — you must not recalculate, round differently, or state a different number). Never ' +
  'state an unverified cause as a confirmed fact — use tentative, investigate-this language. ' +
  'Write everything in Korean.';

// CODE has already decided WHAT happened (the anomaly + its numbers) and WHY
// it was flagged (the detection basis, a fixed threshold restatement). AI is
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
    detectionBasis: a.detectionBasis,
  }));

  return (
    'Below are sales anomalies already detected and computed by deterministic code ' +
    '(previous 7-day period vs current 7-day period, in KRW). Do not recompute or restate ' +
    'the numbers — they are given only so you can interpret them.\n\n' +
    'For each anomaly, write in Korean:\n' +
    '- interpretation: 1-2 Korean sentences on plausible causes to investigate for this change ' +
    '(e.g. promotion, stockout, seasonality, pricing, listing/channel issue, review/CS issue). ' +
    'Frame causes as possibilities to check, not confirmed facts.\n' +
    '- checkItems: 1-3 short Korean phrases, each a specific thing to look at (e.g. "최근 프로모션 ' +
    '집행 여부", "재고/품절 이력", "가격 변경 이력") — not full sentences, just the item to check.\n' +
    '- recommended_action: one concrete, specific Korean sentence describing what to check or do next.\n\n' +
    'Return strictly this JSON shape and nothing else:\n' +
    '{"anomalies":[{"anomaly_id":"<id>","interpretation":"<...>","checkItems":["<...>"],"recommended_action":"<...>"}]}\n\n' +
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
      !Array.isArray(a.checkItems) || a.checkItems.length === 0 ||
      a.checkItems.some((c) => typeof c !== 'string' || c.trim() === '') ||
      typeof a.recommended_action !== 'string' || a.recommended_action.trim() === ''
    ) {
      throw new Error(`AI_SCHEMA_INVALID: malformed anomaly entry ${JSON.stringify(a)}`);
    }
    map.set(a.anomaly_id, {
      interpretation: a.interpretation.trim(),
      checkItems: a.checkItems.map((c) => c.trim()),
      recommended_action: a.recommended_action.trim(),
    });
  }
  for (const id of expectedIds) {
    if (!map.has(id)) {
      throw new Error(`AI_SCHEMA_INVALID: missing entry for anomaly_id ${id}`);
    }
  }
  return map;
}

// Assembles the final result using ONLY code-computed numbers (`anomalies`,
// already carrying detectionBasis/dailyTrend) plus the text fields read out
// of the validated AI response above.
function assembleResult(anomalies, aiMap) {
  return anomalies.map((a, idx) => {
    const ai = aiMap.get(`a${idx}`);
    return {
      ...a,
      rank: idx + 1,
      interpretation: ai.interpretation,
      checkItems: ai.checkItems,
      recommendedAction: ai.recommended_action,
    };
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

// Plain text — safe to paste into Slack/KakaoTalk/email as-is.
function renderSummaryText({ periods, productsAnalyzed, totalSales, anomalies, surgeCount, dropCount }) {
  const lines = [];
  lines.push('[매출 이상 탐지 요약]');
  lines.push(`이전 기간: ${periods.previous.start} ~ ${periods.previous.end}`);
  lines.push(`현재 기간: ${periods.current.start} ~ ${periods.current.end}`);
  lines.push(`분석 상품 수: ${productsAnalyzed}개 / 전체 매출: ${formatWon(totalSales)}`);
  lines.push(`이상 탐지 건수: ${anomalies.length}건 (급증 ${surgeCount}건 / 급감 ${dropCount}건)`);
  if (anomalies.length > 0) {
    const top = anomalies[0];
    const change = top.changeRate === null ? formatWon(top.salesChange) : formatPercent(top.changeRate);
    lines.push(`가장 큰 변동: ${top.product} (${TYPE_LABEL_KO[top.type]}, ${change})`);
  }
  lines.push('');

  lines.push('[이상 탐지 결과 — 심각도 순]');
  if (anomalies.length === 0) {
    lines.push('- 설정된 기준에서 확인이 필요한 매출 변화가 발견되지 않았습니다.');
    return lines.join('\n');
  }

  anomalies.forEach((a) => {
    lines.push(`${a.rank}. [${TYPE_LABEL_KO[a.type]}] ${a.product} — ${formatWon(a.previousSales)} → ${formatWon(a.currentSales)} (${formatPercent(a.changeRate)})`);
    lines.push(`   탐지 근거: ${a.detectionBasis}`);
    lines.push(`   해석: ${a.interpretation}`);
    lines.push(`   확인 항목: ${a.checkItems.join(' / ')}`);
    lines.push(`   추천 조치: ${a.recommendedAction}`);
  });

  return lines.join('\n');
}

const RESULT_CSV_HEADER = [
  '순위', '상품명', '유형', '이전기간매출', '현재기간매출', '매출변화', '변동률',
  '이전수량', '현재수량', '탐지근거', 'AI해석', '확인항목', '추천조치',
];

function renderResultCsv(anomalies) {
  const rows = anomalies.map((a) => [
    a.rank,
    a.product,
    TYPE_LABEL_KO[a.type],
    a.previousSales,
    a.currentSales,
    a.salesChange,
    a.changeRate === null ? '' : `${a.changeRate.toFixed(1)}%`,
    a.previousQuantity,
    a.currentQuantity,
    a.detectionBasis,
    a.interpretation,
    a.checkItems.join(' / '),
    a.recommendedAction,
  ]);
  return toCsv(RESULT_CSV_HEADER, rows);
}

module.exports = {
  TYPE_LABEL_KO,
  ANALYSIS_BASIS_NOTE,
  INTERPRET_SYSTEM_PROMPT,
  buildInterpretPrompt,
  validateInterpretation,
  assembleResult,
  renderSummaryText,
  renderResultCsv,
  formatPercent,
  formatWon,
};
