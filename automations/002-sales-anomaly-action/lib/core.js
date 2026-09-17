'use strict';

// Shared orchestration for #002, used by BOTH the CLI (run.js) and the local
// web server (server.js). Not a generic automation interface — this is the
// one pipeline #002 has.
const { parseCsv } = require('./csv');
const { SchemaError } = require('./schema');
const { validateAndNormalize } = require('./validate');
const {
  aggregateDuplicates,
  computePeriods,
  aggregateByProduct,
  detectAnomalies,
  buildDetectionBasis,
  buildDailyTrend,
} = require('./analysis');
const { callClaude } = require('./ai');
const {
  ANALYSIS_BASIS_NOTE,
  INTERPRET_SYSTEM_PROMPT,
  buildInterpretPrompt,
  validateInterpretation,
  assembleResult,
  renderSummaryText,
  renderResultCsv,
} = require('./pipeline');

const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_FILE_BYTES = 5 * 1024 * 1024;

class PipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function runPipeline(csvText, { model = DEFAULT_MODEL } = {}) {
  if (Buffer.byteLength(csvText || '', 'utf8') > MAX_FILE_BYTES) {
    throw new PipelineError('FILE_TOO_LARGE', `CSV 파일이 5MB를 초과했습니다.`);
  }

  const rows = parseCsv(csvText);

  let records, rowIssues;
  try {
    ({ records, rowIssues } = validateAndNormalize(rows));
  } catch (e) {
    if (e instanceof SchemaError) throw new PipelineError(e.code, e.message);
    throw e;
  }

  const grouped = aggregateDuplicates(records);

  let periods;
  try {
    periods = computePeriods(grouped);
  } catch (e) {
    if (e instanceof SchemaError) throw new PipelineError(e.code, e.message);
    throw e;
  }

  const byProduct = aggregateByProduct(grouped, periods);
  const productsAnalyzed = byProduct.size;
  const rawAnomalies = detectAnomalies(byProduct);
  const totalSales = records.reduce((sum, r) => sum + r.sales, 0);

  // Attach CODE-owned explanation + daily trend before anything touches AI.
  const anomaliesWithBasis = rawAnomalies.map((a) => ({
    ...a,
    detectionBasis: buildDetectionBasis(a),
    dailyTrend: buildDailyTrend(grouped, a.product, periods),
  }));

  // Zero anomalies is a valid result — skip the AI call entirely (nothing to
  // interpret, and the spec forbids inventing findings when none exist).
  if (anomaliesWithBasis.length === 0) {
    const base = {
      periods, productsAnalyzed, totalSales, anomalies: [], rowIssues,
      surgeCount: 0, dropCount: 0, analysisBasisNote: ANALYSIS_BASIS_NOTE,
    };
    return {
      ...base,
      summaryText: renderSummaryText(base),
      resultCsv: renderResultCsv([]),
      meta: { interpretCostUsd: null },
    };
  }

  let interpretResult;
  try {
    interpretResult = callClaude({
      systemPrompt: INTERPRET_SYSTEM_PROMPT,
      userPrompt: buildInterpretPrompt(anomaliesWithBasis),
      model,
    });
  } catch (e) {
    throw new PipelineError('AI_INTERPRET_CALL_FAILED', e.message);
  }

  let aiMap;
  try {
    aiMap = validateInterpretation(interpretResult.parsed, anomaliesWithBasis.map((_, idx) => `a${idx}`));
  } catch (e) {
    throw new PipelineError('AI_INTERPRET_SCHEMA_INVALID', e.message);
  }

  const finalAnomalies = assembleResult(anomaliesWithBasis, aiMap);
  const surgeCount = finalAnomalies.filter((a) => a.type === 'SURGE' || a.type === 'NEW_SURGE').length;
  const dropCount = finalAnomalies.filter((a) => a.type === 'DROP' || a.type === 'DROP_TO_ZERO').length;
  const base = {
    periods, productsAnalyzed, totalSales, anomalies: finalAnomalies, rowIssues,
    surgeCount, dropCount, analysisBasisNote: ANALYSIS_BASIS_NOTE,
  };

  return {
    ...base,
    summaryText: renderSummaryText(base),
    resultCsv: renderResultCsv(finalAnomalies),
    meta: { interpretCostUsd: interpretResult.meta.cost_usd },
  };
}

module.exports = { runPipeline, PipelineError };
