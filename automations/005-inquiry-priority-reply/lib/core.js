'use strict';

// Shared orchestration for #005, used by BOTH the CLI (run.js) and the local
// web server (server.js). Not a generic automation interface — this is the
// one pipeline #005 has.
const { parseCsv } = require('./csv');
const { InputError, validateAndNormalize, scoreRecords, sortByPriority, computeSummary } = require('./analyze');
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
const MAX_ROWS = 300;

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
    throw new PipelineError('TOO_MANY_ROWS', `문의가 ${records.length}건으로 최대 ${MAX_ROWS}건을 초과했습니다.`);
  }

  const scored = scoreRecords(records);
  const sorted = sortByPriority(scored);
  const summary = computeSummary(scored);

  let interpretResult;
  try {
    interpretResult = callClaude({
      systemPrompt: INTERPRET_SYSTEM_PROMPT,
      userPrompt: buildInterpretPrompt(sorted),
      model,
    });
  } catch (e) {
    throw new PipelineError('AI_CALL_FAILED', e.message);
  }

  let aiMap;
  try {
    aiMap = validateInterpretation(interpretResult.parsed, sorted.map((r) => r.id));
  } catch (e) {
    throw new PipelineError('AI_SCHEMA_INVALID', e.message);
  }

  const items = assembleResult(sorted, aiMap);
  const summaryText = renderSummaryText(summary, items);
  const resultCsv = renderResultCsv(items);

  return {
    summary,
    items,
    top5: items.slice(0, 5),
    rowIssues,
    summaryText,
    resultCsv,
    meta: { costUsd: interpretResult.meta.cost_usd },
  };
}

module.exports = { runPipeline, PipelineError, MAX_ROWS };
