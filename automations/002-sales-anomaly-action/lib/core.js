'use strict';

// Shared orchestration for #002, used by BOTH the CLI (run.js) and the local
// web server (server.js). Not a generic automation interface — this is the
// one pipeline #002 has.
const { parseCsv } = require('./csv');
const { SchemaError } = require('./schema');
const { validateAndNormalize } = require('./validate');
const { aggregateDuplicates, computePeriods, aggregateByProduct, detectAnomalies } = require('./analysis');
const { callClaude } = require('./ai');
const { INTERPRET_SYSTEM_PROMPT, buildInterpretPrompt, validateInterpretation, assembleResult, renderMarkdown } = require('./pipeline');

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

  let records;
  try {
    ({ records } = validateAndNormalize(rows));
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
  const anomalies = detectAnomalies(byProduct);

  // Zero anomalies is a valid result — skip the AI call entirely (nothing to
  // interpret, and the spec forbids inventing findings when none exist).
  if (anomalies.length === 0) {
    const markdown = renderMarkdown({ periods, productsAnalyzed, anomalies: [] });
    return { periods, productsAnalyzed, anomalies: [], markdown, meta: { interpretCostUsd: null } };
  }

  let interpretResult;
  try {
    interpretResult = callClaude({
      systemPrompt: INTERPRET_SYSTEM_PROMPT,
      userPrompt: buildInterpretPrompt(anomalies),
      model,
    });
  } catch (e) {
    throw new PipelineError('AI_INTERPRET_CALL_FAILED', e.message);
  }

  let aiMap;
  try {
    aiMap = validateInterpretation(interpretResult.parsed, anomalies.map((_, idx) => `a${idx}`));
  } catch (e) {
    throw new PipelineError('AI_INTERPRET_SCHEMA_INVALID', e.message);
  }

  const finalAnomalies = assembleResult(anomalies, aiMap);
  const markdown = renderMarkdown({ periods, productsAnalyzed, anomalies: finalAnomalies });

  return {
    periods,
    productsAnalyzed,
    anomalies: finalAnomalies,
    markdown,
    meta: { interpretCostUsd: interpretResult.meta.cost_usd },
  };
}

module.exports = { runPipeline, PipelineError };
