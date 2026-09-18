'use strict';

// CODE owns every number, grade, and sort order in #006. The AI never
// computes a quantity, changes a grade, or reorders results — it only
// writes explanatory text on top of the numbers this file has already
// decided (see lib/pipeline.js).

const GRADE_IMMEDIATE = '즉시 발주';
const GRADE_REVIEW = '발주 검토';
const GRADE_NORMAL = '정상';
const GRADE_RANK = { [GRADE_IMMEDIATE]: 0, [GRADE_REVIEW]: 1, [GRADE_NORMAL]: 2 };

function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

// Pure per-record calculation — section 4.1/4.2 of the #006 spec, verbatim.
function computeRecord(rec) {
  const availableStock = rec.currentStock - rec.reservedStock;
  const avgDailyOutflow = rec.periodOutflow / rec.periodDays;
  const leadTimeDemand = avgDailyOutflow * rec.leadTimeDays;
  const projectedStockAtLeadTime = availableStock - leadTimeDemand;
  const daysUntilStockout = avgDailyOutflow > 0 ? Math.max(availableStock, 0) / avgDailyOutflow : null;
  const neededOrderQty = Math.max(0, rec.safetyStock - projectedStockAtLeadTime);
  const recommendedOrderQty =
    neededOrderQty === 0 ? 0 : Math.ceil(neededOrderQty / rec.minOrderQty) * rec.minOrderQty;
  const expectedOrderAmount = recommendedOrderQty * rec.unitCost;

  let grade;
  if (availableStock <= 0 || (avgDailyOutflow > 0 && daysUntilStockout <= rec.leadTimeDays)) {
    grade = GRADE_IMMEDIATE;
  } else if (availableStock <= rec.safetyStock || projectedStockAtLeadTime < rec.safetyStock) {
    grade = GRADE_REVIEW;
  } else {
    grade = GRADE_NORMAL;
  }

  const reasons = buildReasons({
    availableStock, avgDailyOutflow, daysUntilStockout, leadTimeDays: rec.leadTimeDays,
    projectedStockAtLeadTime, safetyStock: rec.safetyStock, grade,
  });

  return {
    ...rec,
    availableStock,
    avgDailyOutflow,
    leadTimeDemand,
    projectedStockAtLeadTime,
    daysUntilStockout,
    neededOrderQty,
    recommendedOrderQty,
    expectedOrderAmount,
    grade,
    reasons,
  };
}

// Every reason sentence is generated from the same numbers the grade was
// decided from — the AI never sees this list until after it is final and
// never rewrites it (see lib/pipeline.js buildInterpretPrompt).
function buildReasons({ availableStock, avgDailyOutflow, daysUntilStockout, leadTimeDays, projectedStockAtLeadTime, safetyStock, grade }) {
  const reasons = [];

  if (availableStock <= 0) {
    reasons.push(`가용재고가 ${availableStock}개로 예약재고가 현재재고를 초과함`);
  }

  if (avgDailyOutflow === 0) {
    reasons.push('최근 출고량이 0이라 소진일을 계산하지 않음');
  } else if (daysUntilStockout !== null && daysUntilStockout <= leadTimeDays) {
    reasons.push(`${round1(daysUntilStockout)}일 후 소진 예상, 입고에는 ${leadTimeDays}일 필요`);
  }

  if (grade !== GRADE_IMMEDIATE) {
    if (projectedStockAtLeadTime < safetyStock) {
      reasons.push(`입고 시점 예상재고 ${round1(projectedStockAtLeadTime)}개로 안전재고 ${safetyStock}개 미만`);
    } else if (availableStock <= safetyStock) {
      reasons.push(`가용재고 ${availableStock}개가 안전재고 ${safetyStock}개 이하`);
    }
  }

  if (reasons.length === 0) {
    reasons.push('입고 시점에도 안전재고 이상 유지 예상');
  }

  return reasons;
}

// Section 4.4 sort order, exactly: grade, then (소진예상일 - 입고소요일) asc
// with "no 소진예상일" sorted last within its grade, then 입고시점예상재고
// asc, then 예상발주금액 desc, then original row number asc.
function sortRecords(records) {
  return [...records].sort((a, b) => {
    const gradeDiff = GRADE_RANK[a.grade] - GRADE_RANK[b.grade];
    if (gradeDiff !== 0) return gradeDiff;

    const aKey = a.daysUntilStockout === null ? Infinity : a.daysUntilStockout - a.leadTimeDays;
    const bKey = b.daysUntilStockout === null ? Infinity : b.daysUntilStockout - b.leadTimeDays;
    if (aKey !== bKey) return aKey - bKey;

    if (a.projectedStockAtLeadTime !== b.projectedStockAtLeadTime) {
      return a.projectedStockAtLeadTime - b.projectedStockAtLeadTime;
    }

    if (a.expectedOrderAmount !== b.expectedOrderAmount) {
      return b.expectedOrderAmount - a.expectedOrderAmount;
    }

    return a.rowNumber - b.rowNumber;
  });
}

// Takes the FINAL display items (after toDisplay() rounding has already been
// applied) so the KPI total always equals the sum a person would get by
// adding up the same rounded 예상발주금액 values shown in the table.
function computeSummary(items) {
  const immediate = items.filter((r) => r.grade === GRADE_IMMEDIATE).length;
  const review = items.filter((r) => r.grade === GRADE_REVIEW).length;
  const normal = items.filter((r) => r.grade === GRADE_NORMAL).length;
  const expectedOrderTotal = items.reduce((sum, r) => sum + r.expectedOrderAmount, 0);
  return {
    total: items.length,
    immediate,
    review,
    normal,
    expectedOrderTotal,
  };
}

// Rounds computed fields ONCE for display — the same rounded numbers are
// then used by the JSON API, the on-screen render, and the result CSV, so
// none of them can ever disagree with each other (spec section 4.2/9).
function toDisplay(r) {
  return {
    availableStock: r.availableStock,
    avgDailyOutflow: round2(r.avgDailyOutflow),
    leadTimeDemand: round1(r.leadTimeDemand),
    projectedStockAtLeadTime: round1(r.projectedStockAtLeadTime),
    daysUntilStockout: r.daysUntilStockout === null ? null : round1(r.daysUntilStockout),
    recommendedOrderQty: r.recommendedOrderQty,
    expectedOrderAmount: Math.round(r.expectedOrderAmount),
  };
}

// TOP N risk items — 즉시 발주 then 발주 검토, never padded with 정상 items.
function topRisk(sorted, limit) {
  return sorted.filter((r) => r.grade !== GRADE_NORMAL).slice(0, limit);
}

// 공급처별 발주안 — only items with a nonzero recommended quantity, grouped
// by supplier, in the same priority order as the main sort.
function groupBySupplier(sorted) {
  const groups = new Map();
  sorted.forEach((r) => {
    if (r.recommendedOrderQty < 1) return;
    if (!groups.has(r.supplier)) groups.set(r.supplier, []);
    groups.get(r.supplier).push(r);
  });
  return [...groups.entries()].map(([supplier, items]) => ({ supplier, items }));
}

module.exports = {
  GRADE_IMMEDIATE,
  GRADE_REVIEW,
  GRADE_NORMAL,
  computeRecord,
  sortRecords,
  computeSummary,
  toDisplay,
  topRisk,
  groupBySupplier,
  round1,
  round2,
};
