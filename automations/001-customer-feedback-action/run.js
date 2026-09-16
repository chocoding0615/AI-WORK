#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { parseCsv, validateInput } = require('./lib/csv');
const { callClaude } = require('./lib/ai');
const { aggregate, validateClassification } = require('./lib/aggregate');
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
} = require('./lib/pipeline');

const MAX_REVIEWS = 300;
const MODEL = 'claude-sonnet-5';
const BULLET_LIMIT = 5;

function fail(code, message) {
  console.error(`[#001 FAILED] ${code}: ${message}`);
  process.exit(1);
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) fail('MISSING_ARG', 'Usage: node run.js <path-to-reviews.csv> [--out <path>]');

  let text;
  try {
    text = fs.readFileSync(csvPath, 'utf8');
  } catch (e) {
    fail('FILE_NOT_READABLE', e.message);
  }

  const rows = parseCsv(text);
  const validation = validateInput(rows, { maxReviews: MAX_REVIEWS });
  if (!validation.ok) fail(validation.code, validation.message);

  const { reviews, blankSkipped } = validation;
  console.error(`[#001] Loaded ${reviews.length} usable reviews (skipped ${blankSkipped} blank rows).`);

  // AI call 1: structured classification (AI OWNS meaning/theme; CODE OWNS
  // everything downstream — counting, sorting, evidence).
  let classifyResult;
  try {
    classifyResult = callClaude({
      systemPrompt: CLASSIFY_SYSTEM_PROMPT,
      userPrompt: buildClassifyPrompt(reviews),
      model: MODEL,
    });
  } catch (e) {
    fail('AI_CLASSIFY_CALL_FAILED', e.message);
  }
  try {
    validateClassification(classifyResult.parsed, reviews);
  } catch (e) {
    fail('AI_CLASSIFY_SCHEMA_INVALID', e.message);
  }
  console.error(`[#001] Classification call ok (cost: $${classifyResult.meta.cost_usd ?? 'n/a'}).`);

  const themes = aggregate(reviews, classifyResult.parsed.classifications);

  // Deterministic (code-owned) selection — order and membership never
  // depend on anything the AI says beyond category/theme per review.
  const likes = topByCategory(themes, 'praise', BULLET_LIMIT);
  const complaints = topByCategory(themes, 'complaint', BULLET_LIMIT);
  const requests = topByCategory(themes, 'request', BULLET_LIMIT);
  const complaintAndRequest = themes
    .filter((t) => t.category === 'complaint' || t.category === 'request')
    .sort((a, b) => b.mention_count - a.mention_count);
  const actionThemes = complaintAndRequest.slice(0, 5);
  const watchOut = complaintAndRequest.slice(5, 10);

  const insightThemes = dedupThemes([likes, complaints, requests, watchOut]);

  // AI call 2: interpretation only, scoped to code-selected theme_ids.
  let interpretResult;
  try {
    interpretResult = callClaude({
      systemPrompt: INTERPRET_SYSTEM_PROMPT,
      userPrompt: buildInterpretPrompt({ insightThemes, actionThemes }),
      model: MODEL,
    });
  } catch (e) {
    fail('AI_INTERPRET_CALL_FAILED', e.message);
  }

  let insightMap, actionMap;
  try {
    ({ insightMap, actionMap } = validateInterpretation(
      interpretResult.parsed,
      insightThemes.map((t) => t.theme_id),
      actionThemes.map((t) => t.theme_id)
    ));
  } catch (e) {
    fail('AI_INTERPRET_SCHEMA_INVALID', e.message);
  }
  console.error(`[#001] Interpretation call ok (cost: $${interpretResult.meta.cost_usd ?? 'n/a'}).`);

  const result = assembleResult({ themes, likes, complaints, requests, watchOut, actionThemes, insightMap, actionMap });

  try {
    verifyEvidenceIntegrity(result, reviews);
  } catch (e) {
    fail('EVIDENCE_INTEGRITY_FAILURE', e.message);
  }
  console.error('[#001] Evidence integrity verified against input CSV.');

  const markdown = renderMarkdown(result, { totalReviews: reviews.length, blankSkipped });
  console.log(markdown);

  const outIdx = process.argv.indexOf('--out');
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    fs.writeFileSync(process.argv[outIdx + 1], markdown, 'utf8');
    console.error(`[#001] Result written to ${process.argv[outIdx + 1]}`);
  }
}

main();
