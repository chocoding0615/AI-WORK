'use strict';

const { toCsv } = require('./csv');
const { toDisplay } = require('./analysis');

const INTERPRET_SYSTEM_PROMPT =
  'You are an inventory replenishment assistant. You output ONLY a single JSON object matching ' +
  'the schema the user describes. No markdown, no code fences, no commentary. You must cover ' +
  'every id given to you exactly once and invent no new ids. Every quantity, amount, grade, and ' +
  'ranking in the input is already final and decided by the caller — never state a different ' +
  'number, never suggest a different order quantity, never re-rank items. Never invent a contact ' +
  'person, phone number, email, or a confirmed delivery date — the supplier has not confirmed ' +
  'anything yet. Never say an order has actually been placed or received; this is a draft request ' +
  'only. Write every output field in Korean, in a plain, professional 업무 tone (합니다/드립니다체).';

// CODE has already decided every number, the grade, and the order — the AI
// only writes riskSummary/nextAction/orderDraft text around numbers it is
// given, and those numbers are never read back out of its response.
function buildInterpretPrompt(items) {
  const payload = items.map((it) => ({
    id: it.id,
    상품코드: it.code,
    상품명: it.name,
    공급처: it.supplier,
    발주등급: it.grade,
    가용재고: it.availableStock,
    일평균출고량: it.avgDailyOutflow,
    재고소진예상일: it.daysUntilStockout,
    입고소요일: it.leadTimeDays,
    입고시점예상재고: it.projectedStockAtLeadTime,
    안전재고: it.safetyStock,
    권장발주량: it.recommendedOrderQty,
    예상발주금액: it.expectedOrderAmount,
    코드계산근거: it.reasons,
  }));

  return (
    '아래는 발주 우선순위가 이미 계산된 재고 상품 목록입니다. 각 상품에 대해 다음 세 가지를 작성하세요.\n\n' +
    '1. riskSummary: 실무자가 바로 이해할 수 있는 위험 요약 한 문장. 주어진 발주등급과 코드계산근거를 ' +
    '풀어서 설명하되 숫자를 바꾸지 마세요.\n' +
    '2. nextAction: 담당자가 다음에 할 구체적인 행동 한 문장.\n' +
    '3. orderDraft: 공급처에 보낼 발주 요청 초안. 권장발주량이 0보다 크면 아래 형식을 그대로 따르고 ' +
    '괄호 안 값만 주어진 숫자로 채우세요(숫자를 새로 만들거나 바꾸지 마세요):\n' +
    '   "안녕하세요. 아래 상품의 재고 상황을 확인하여 발주 가능 여부와 예상 입고 일정을 회신 ' +
    '부탁드립니다.\\n\\n상품명: (상품명)\\n상품코드: (상품코드)\\n요청 수량: (권장발주량)\\n' +
    '현재 가용재고: (가용재고)\\n입고 전 예상 부족량: (안전재고 - 입고시점예상재고, 0 미만이면 0)\\n\\n' +
    '실제 발주 확정 전 수량과 납기를 다시 확인 부탁드립니다."\n' +
    '   권장발주량이 0이면 발주가 필요하지 않다는 짧은 안내 문장으로 대신하세요.\n\n' +
    'Return strictly this JSON shape and nothing else:\n' +
    '{"items":[{"id":<number>,"riskSummary":"<...>","nextAction":"<...>","orderDraft":"<...>"}]}\n\n' +
    `상품 목록:\n${JSON.stringify(payload, null, 1)}`
  );
}

function validateInterpretation(response, expectedIds) {
  if (!response || !Array.isArray(response.items)) {
    throw new Error('AI_SCHEMA_INVALID: items missing or not an array');
  }
  const map = new Map();
  for (const it of response.items) {
    if (
      typeof it.id !== 'number' ||
      typeof it.riskSummary !== 'string' || it.riskSummary.trim() === '' ||
      typeof it.nextAction !== 'string' || it.nextAction.trim() === '' ||
      typeof it.orderDraft !== 'string' || it.orderDraft.trim() === ''
    ) {
      throw new Error(`AI_SCHEMA_INVALID: malformed item ${JSON.stringify(it)}`);
    }
    map.set(it.id, {
      riskSummary: it.riskSummary.trim(),
      nextAction: it.nextAction.trim(),
      orderDraft: it.orderDraft.trim(),
    });
  }
  for (const id of expectedIds) {
    if (!map.has(id)) throw new Error(`AI_SCHEMA_INVALID: missing item for id ${id}`);
  }
  return map;
}

// Code-owned fallback text — used when the AI call fails or returns a
// malformed response, so a calculated result is never thrown away (spec
// section 5). Built only from numbers/text the caller already computed.
function fallbackOrderDraft(it) {
  if (it.recommendedOrderQty <= 0) {
    return '현재 재고 상황에서는 즉시 발주가 필요하지 않습니다. 안전재고 이상을 유지할 것으로 예상됩니다.';
  }
  const shortage = Math.max(0, Math.round((it.safetyStock - it.projectedStockAtLeadTime) * 10) / 10);
  return (
    '안녕하세요. 아래 상품의 재고 상황을 확인하여 발주 가능 여부와 예상 입고 일정을 회신 부탁드립니다.\n\n' +
    `상품명: ${it.name}\n` +
    `상품코드: ${it.code}\n` +
    `요청 수량: ${it.recommendedOrderQty}\n` +
    `현재 가용재고: ${it.availableStock}\n` +
    `입고 전 예상 부족량: ${shortage}\n\n` +
    '실제 발주 확정 전 수량과 납기를 다시 확인 부탁드립니다.'
  );
}

function fallbackNextAction(it) {
  if (it.grade === '즉시 발주') return '지금 공급처에 발주 요청을 보내고 입고 일정을 확인하세요.';
  if (it.grade === '발주 검토') return '안전재고 유지 여부를 확인하고 필요 시 발주를 준비하세요.';
  return '특별한 조치가 필요하지 않습니다. 정기 점검 시 재확인하세요.';
}

function fallbackRiskSummary(it) {
  return `${it.grade} — ${it.reasons.join(' · ')}`;
}

function fallbackText(it) {
  return {
    riskSummary: fallbackRiskSummary(it),
    nextAction: fallbackNextAction(it),
    orderDraft: fallbackOrderDraft(it),
  };
}

// Merges CODE truth (every number, grade, reason, order) with AI text (or
// the code-owned fallback above). Numbers only ever come from the left
// side — aiMap null/undefined for an id means "use the fallback".
function assembleResult(sortedRecords, aiMap) {
  return sortedRecords.map((r, idx) => {
    const display = toDisplay(r);
    const base = {
      id: r.id,
      priority: idx + 1,
      rowNumber: r.rowNumber,
      code: r.code,
      name: r.name,
      supplier: r.supplier,
      currentStock: r.currentStock,
      reservedStock: r.reservedStock,
      periodOutflow: r.periodOutflow,
      periodDays: r.periodDays,
      safetyStock: r.safetyStock,
      leadTimeDays: r.leadTimeDays,
      minOrderQty: r.minOrderQty,
      unitCost: r.unitCost,
      ...display,
      grade: r.grade,
      reasons: r.reasons,
    };
    const ai = aiMap ? aiMap.get(r.id) : null;
    const text = ai || fallbackText(base);
    return { ...base, ...text };
  });
}

// Plain text summary — pasteable into Slack/KakaoTalk/email as-is.
function renderSummaryText(summary, items) {
  const lines = [];
  lines.push('[발주 우선순위 요약]');
  lines.push(
    `- 분석 상품 ${summary.total}건 / 즉시 발주 ${summary.immediate}건 / 발주 검토 ${summary.review}건 / ` +
    `정상 ${summary.normal}건 / 예상 발주금액 ${summary.expectedOrderTotal.toLocaleString('ko-KR')}원`
  );
  lines.push('');
  lines.push('[먼저 발주할 TOP 5]');
  const top = items.filter((it) => it.grade !== '정상').slice(0, 5);
  if (top.length === 0) {
    lines.push('- 없음 (즉시 발주·발주 검토 대상 없음)');
  } else {
    top.forEach((it, i) => {
      lines.push(
        `${i + 1}. [${it.grade}] ${it.name} (${it.code}) · 공급처 ${it.supplier} · ` +
        `권장발주량 ${it.recommendedOrderQty}개 · 예상금액 ${it.expectedOrderAmount.toLocaleString('ko-KR')}원`
      );
      lines.push(`   판단 근거: ${it.reasons.join(' / ')}`);
    });
  }
  lines.push('');
  lines.push('실제 발주 전 재고와 납기는 공급처에 다시 확인해주세요.');
  return lines.join('\n');
}

const RESULT_CSV_HEADER = [
  '우선순위', '발주등급', '상품코드', '상품명', '공급처',
  '현재재고', '예약재고', '가용재고', '기간출고량', '집계일수', '일평균출고량',
  '안전재고', '입고소요일', '입고기간예상수요', '입고시점예상재고', '재고소진예상일',
  '최소발주수량', '권장발주량', '매입단가', '예상발주금액',
  '판단근거', '다음행동', '발주요청초안', '원본행번호',
];

function renderResultCsv(items) {
  const rows = items.map((it) => [
    it.priority,
    it.grade,
    it.code,
    it.name,
    it.supplier,
    it.currentStock,
    it.reservedStock,
    it.availableStock,
    it.periodOutflow,
    it.periodDays,
    it.avgDailyOutflow,
    it.safetyStock,
    it.leadTimeDays,
    it.leadTimeDemand,
    it.projectedStockAtLeadTime,
    it.daysUntilStockout === null ? '' : it.daysUntilStockout,
    it.minOrderQty,
    it.recommendedOrderQty,
    it.unitCost,
    it.expectedOrderAmount,
    it.reasons.join(' / '),
    it.nextAction,
    it.orderDraft,
    it.rowNumber,
  ]);
  return toCsv(RESULT_CSV_HEADER, rows);
}

module.exports = {
  INTERPRET_SYSTEM_PROMPT,
  buildInterpretPrompt,
  validateInterpretation,
  fallbackText,
  assembleResult,
  renderSummaryText,
  renderResultCsv,
  RESULT_CSV_HEADER,
};
