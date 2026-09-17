'use strict';

// Shared orchestration for #004, used by BOTH the CLI (run.js) and the local
// web server (server.js). Not a generic automation interface — this is the
// one pipeline #004 has.
const { callClaude } = require('./ai');
const { SYSTEM_PROMPT, buildPrompt, validateResponse, renderPlainText } = require('./pipeline');

const DEFAULT_MODEL = 'claude-sonnet-5';

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

  let aiResult;
  try {
    aiResult = callClaude({ systemPrompt: SYSTEM_PROMPT, userPrompt: buildPrompt(text), model });
  } catch (e) {
    throw new PipelineError('AI_CALL_FAILED', e.message);
  }

  let result;
  try {
    result = validateResponse(aiResult.parsed);
  } catch (e) {
    throw new PipelineError('AI_SCHEMA_INVALID', e.message);
  }

  const plainText = renderPlainText(result);

  return { result, plainText, meta: { costUsd: aiResult.meta.cost_usd } };
}

module.exports = { runPipeline, PipelineError };
