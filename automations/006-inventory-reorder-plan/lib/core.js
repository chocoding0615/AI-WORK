'use strict';

// Shared orchestration for #006, used by BOTH the CLI (run.js) and the local
// web server (server.js). Not a generic automation interface — this is the
// one pipeline #006 has.
const { parseCsv } = require('./csv');
const { InputError, validateAndNormalize, MAX_ROWS } = require('./validate');
const { computeRecord, sortRecords, computeSummary, topRisk, groupBySupplier } = require('./analysis');
const { callClaude } = require('./ai');
const {
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
    throw new PipelineError('FILE_TOO_LARGE', 'CSV 파일이 5MB를 초과했습니다.');
  }

  const rows = parseCsv(csvText || '');

  let records, rowIssues;
  try {
    ({ records, rowIssues } = validateAndNormalize(rows));
  } catch (e) {
    if (e instanceof InputError) throw new PipelineError(e.code, e.message);
    throw e;
  }

  if (records.length > MAX_ROWS) {
    throw new PipelineError('TOO_MANY_ROWS', `상품이 ${records.length}건으로 최대 ${MAX_ROWS}건을 초과했습니다.`);
  }

  const computed = records.map((r, idx) => computeRecord({ ...r, id: idx }));
  const sorted = sortRecords(computed);

  // AI failure (call error or a malformed/incomplete response) must not
  // discard the calculated result — fall back to code-owned text and keep
  // going. See lib/pipeline.js fallbackText() and spec section 5.
  let aiMap = null;
  let aiDegraded = false;
  try {
    const interpretResult = callClaude({
      systemPrompt: INTERPRET_SYSTEM_PROMPT,
      userPrompt: buildInterpretPrompt(sorted),
      model,
    });
    aiMap = validateInterpretation(interpretResult.parsed, sorted.map((r) => r.id));
  } catch (e) {
    console.error(`[#006] AI 설명 생성 실패 — 기본 문안으로 대체: ${e.message}`);
    aiDegraded = true;
    aiMap = null;
  }

  const items = assembleResult(sorted, aiMap);
  const summary = computeSummary(items);
  const top5 = topRisk(items, 5);
  const supplierGroups = groupBySupplier(items);
  const summaryText = renderSummaryText(summary, items);
  const resultCsv = renderResultCsv(items);

  return {
    summary,
    items,
    top5,
    supplierGroups,
    rowIssues,
    aiDegraded,
    summaryText,
    resultCsv,
  };
}

module.exports = { runPipeline, PipelineError, MAX_ROWS };
