'use strict';

// Shared orchestration for #001, used by BOTH the CLI (run.js) and the
// local web server (server.js). This is not a generic automation
// interface — it is the one pipeline #001 has, extracted once because it
// now has two entry points instead of one.
const { parseCsv, validateInput } = require('./csv');
const { callClaude } = require('./ai');
const { aggregate, validateClassification } = require('./aggregate');
const {
  CLASSIFY_SYSTEM_PROMPT,
  INTERPRET_SYSTEM_PROMPT,
  buildClassifyPrompt,
  buildInterpretPrompt,
  validateInterpretation,
  topByCategory,
  dedupThemes,
  verifyEvidenceIntegrity,
  assembleResult,
  renderMarkdown,
} = require('./pipeline');

const DEFAULT_MAX_REVIEWS = 300;
const DEFAULT_MODEL = 'claude-sonnet-5';
const BULLET_LIMIT = 5;

class PipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function runPipeline(csvText, { maxReviews = DEFAULT_MAX_REVIEWS, model = DEFAULT_MODEL } = {}) {
  const rows = parseCsv(csvText);
  const validation = validateInput(rows, { maxReviews });
  if (!validation.ok) throw new PipelineError(validation.code, validation.message);

  const { reviews, blankSkipped } = validation;

  let classifyResult;
  try {
    classifyResult = callClaude({
      systemPrompt: CLASSIFY_SYSTEM_PROMPT,
      userPrompt: buildClassifyPrompt(reviews),
      model,
    });
  } catch (e) {
    throw new PipelineError('AI_CLASSIFY_CALL_FAILED', e.message);
  }
  try {
    validateClassification(classifyResult.parsed, reviews);
  } catch (e) {
    throw new PipelineError('AI_CLASSIFY_SCHEMA_INVALID', e.message);
  }

  const themes = aggregate(reviews, classifyResult.parsed.classifications);

  const likes = topByCategory(themes, 'praise', BULLET_LIMIT);
  const complaints = topByCategory(themes, 'complaint', BULLET_LIMIT);
  const requests = topByCategory(themes, 'request', BULLET_LIMIT);
  const complaintAndRequest = themes
    .filter((t) => t.category === 'complaint' || t.category === 'request')
    .sort((a, b) => b.mention_count - a.mention_count);
  const actionThemes = complaintAndRequest.slice(0, 5);
  const watchOut = complaintAndRequest.slice(5, 10);
  const insightThemes = dedupThemes([likes, complaints, requests, watchOut]);

  let interpretResult;
  try {
    interpretResult = callClaude({
      systemPrompt: INTERPRET_SYSTEM_PROMPT,
      userPrompt: buildInterpretPrompt({ insightThemes, actionThemes }),
      model,
    });
  } catch (e) {
    throw new PipelineError('AI_INTERPRET_CALL_FAILED', e.message);
  }

  let insightMap, actionMap;
  try {
    ({ insightMap, actionMap } = validateInterpretation(
      interpretResult.parsed,
      insightThemes.map((t) => t.theme_id),
      actionThemes.map((t) => t.theme_id)
    ));
  } catch (e) {
    throw new PipelineError('AI_INTERPRET_SCHEMA_INVALID', e.message);
  }

  const result = assembleResult({ themes, likes, complaints, requests, watchOut, actionThemes, insightMap, actionMap });

  try {
    verifyEvidenceIntegrity(result, reviews);
  } catch (e) {
    throw new PipelineError('EVIDENCE_INTEGRITY_FAILURE', e.message);
  }

  const markdown = renderMarkdown(result, { totalReviews: reviews.length, blankSkipped });

  return {
    result,
    markdown,
    meta: {
      totalReviews: reviews.length,
      blankSkipped,
      classifyCostUsd: classifyResult.meta.cost_usd,
      interpretCostUsd: interpretResult.meta.cost_usd,
    },
  };
}

module.exports = { runPipeline, PipelineError };
