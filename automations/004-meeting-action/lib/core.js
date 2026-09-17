'use strict';

// Shared orchestration for #004, used by BOTH the CLI (run.js) and the local
// web server (server.js). Not a generic automation interface — this is the
// one pipeline #004 has.
const { callClaude } = require('./ai');
const {
  SYSTEM_PROMPT,
  buildPrompt,
  validateResponse,
  computeSummary,
  renderPlainText,
  renderResultCsv,
} = require('./pipeline');

const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

class PipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function runPipeline(meetingText, { model = DEFAULT_MODEL } = {}) {
  const text = (meetingText || '').trim();
  if (text === '') {
    throw new PipelineError('EMPTY_INPUT', '회의 내용을 입력해주세요.');
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
    throw new PipelineError('FILE_TOO_LARGE', '회의록 텍스트가 2MB를 초과했습니다.');
  }

  let aiResult;
  try {
    aiResult = callClaude({ systemPrompt: SYSTEM_PROMPT, userPrompt: buildPrompt(text), model });
  } catch (e) {
    throw new PipelineError('AI_CALL_FAILED', e.message);
  }

  let result;
  try {
    result = validateResponse(aiResult.parsed, text);
  } catch (e) {
    throw new PipelineError('AI_SCHEMA_INVALID', e.message);
  }

  const summary = computeSummary(result);
  const plainText = renderPlainText(result, summary);
  const resultCsv = renderResultCsv(result);

  return { summary, result, plainText, resultCsv, meta: { costUsd: aiResult.meta.cost_usd } };
}

module.exports = { runPipeline, PipelineError };
