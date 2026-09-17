'use strict';

const MIN_RECURRING_MONTHS = 3;
const MAX_DAY_RANGE = 10; // equivalent to "every representative day within +-5 of some reference day"

function monthKey(iso) {
  return iso.slice(0, 7);
}

function dayOfMonth(iso) {
  return Number(iso.slice(8, 10));
}

// Fixed, explicit representative-day rule: median day-of-month of that
// month's transaction dates. Even count -> round the average of the two
// middle values. No merchant-name normalization beyond the trim already
// done in validate.js.
function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// merchant -> Map(monthKey -> { amountSum, days: [] })
function groupByMerchantMonth(records) {
  const byMerchant = new Map();
  for (const r of records) {
    const month = monthKey(r.date);
    const day = dayOfMonth(r.date);
    if (!byMerchant.has(r.merchant)) byMerchant.set(r.merchant, new Map());
    const byMonth = byMerchant.get(r.merchant);
    if (!byMonth.has(month)) byMonth.set(month, { amountSum: 0, days: [] });
    const bucket = byMonth.get(month);
    bucket.amountSum += r.amount;
    bucket.days.push(day);
  }
  return byMerchant;
}

// Rule v1: a merchant is a MONTHLY_RECURRING candidate when it has activity
// in >=3 distinct calendar months AND every month's representative
// (median) payment day falls within a +-5 day band of some common day —
// i.e. max(repDay) - min(repDay) <= 10. Amounts need not match.
function detectRecurring(byMerchant) {
  const candidates = [];

  for (const [merchant, byMonth] of byMerchant.entries()) {
    const months = [...byMonth.keys()].sort(); // "YYYY-MM" sorts chronologically
    const recurringMonths = months.length;
    if (recurringMonths < MIN_RECURRING_MONTHS) continue;

    const repDays = months.map((m) => median(byMonth.get(m).days));
    const minDay = Math.min(...repDays);
    const maxDay = Math.max(...repDays);
    if (maxDay - minDay > MAX_DAY_RANGE) continue;

    const monthlyAmounts = months.map((m) => ({ month: m, amount: byMonth.get(m).amountSum }));
    const totalAmount = monthlyAmounts.reduce((sum, x) => sum + x.amount, 0);
    const averageMonthlyAmount = totalAmount / recurringMonths;
    const latestMonthAmount = monthlyAmounts[monthlyAmounts.length - 1].amount;
    const annualizedAmount = averageMonthlyAmount * 12;

    const dayRange = maxDay - minDay;
    const amounts = monthlyAmounts.map((m) => m.amount);
    const amountVaries = Math.max(...amounts) !== Math.min(...amounts);

    // Deterministic, code-owned confidence label — NOT an AI guess. Tighter
    // day-of-month clustering and more observed months = higher confidence
    // this is a genuinely recurring monthly charge.
    let confidence;
    if (dayRange <= 3 && recurringMonths >= 4) confidence = '높음';
    else if (dayRange <= MAX_DAY_RANGE && recurringMonths >= MIN_RECURRING_MONTHS) confidence = '보통';
    else confidence = '낮음';

    candidates.push({
      merchant,
      recurringMonths,
      typicalPaymentDay: median(repDays),
      paymentDayRange: { min: minDay, max: maxDay },
      monthlyAmounts,
      averageMonthlyAmount,
      totalAmount,
      latestMonthAmount,
      annualizedAmount,
      confidence,
      amountVaries,
      // Actual usage is never in the input, so #003 never guesses it — every
      // candidate needs a human to confirm it before any action is taken.
      executionStatus: '검토 필요',
    });
  }

  candidates.sort((a, b) => b.annualizedAmount - a.annualizedAmount);
  return candidates;
}

// Exact-name-collision-after-normalization only (trim/lowercase/strip
// whitespace) — no fuzzy/semantic matching. Flags likely duplicate
// subscriptions or inconsistent merchant naming for the same service.
function findDuplicateMerchantClusters(candidates) {
  const groups = new Map();
  for (const c of candidates) {
    const key = c.merchant.trim().toLowerCase().replace(/\s+/g, '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c.merchant);
  }
  const clusters = [];
  for (const names of groups.values()) {
    const distinct = [...new Set(names)];
    if (distinct.length > 1) clusters.push(distinct);
  }
  return clusters;
}

function computeSummary(records, candidates) {
  const dates = records.map((r) => r.date).sort();
  const totalAmount = records.reduce((sum, r) => sum + r.amount, 0);
  const averageMonthlyRecurringTotal = candidates.reduce((sum, c) => sum + c.averageMonthlyAmount, 0);
  const annualizedRecurringTotal = candidates.reduce((sum, c) => sum + c.annualizedAmount, 0);

  return {
    totalTransactions: records.length,
    totalAmount,
    analyzedPeriod: { start: dates[0], end: dates[dates.length - 1] },
    recurringCandidateCount: candidates.length,
    averageMonthlyRecurringTotal,
    annualizedRecurringTotal,
    // Never a confirmed savings figure — #003 has no signal on which
    // candidates are actually cancelable, so this is always "확인 필요".
    potentialSavingsLabel: '확인 필요',
  };
}

module.exports = {
  groupByMerchantMonth,
  detectRecurring,
  computeSummary,
  findDuplicateMerchantClusters,
  median,
  monthKey,
  dayOfMonth,
};
