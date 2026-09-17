#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { runPipeline, PipelineError } = require('./lib/core');

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

  let output;
  try {
    output = runPipeline(text);
  } catch (e) {
    if (e instanceof PipelineError) fail(e.code, e.message);
    fail('UNEXPECTED_ERROR', e.message);
    return;
  }

  console.error(`[#001] Loaded ${output.meta.totalReviews} usable reviews (skipped ${output.meta.blankSkipped} blank rows).`);
  console.error(`[#001] Classification call ok (cost: $${output.meta.classifyCostUsd ?? 'n/a'}).`);
  console.error(`[#001] Interpretation call ok (cost: $${output.meta.interpretCostUsd ?? 'n/a'}).`);
  console.error('[#001] Evidence integrity verified against input CSV.');

  console.log(output.summaryText);

  const outIdx = process.argv.indexOf('--out');
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    fs.writeFileSync(process.argv[outIdx + 1], output.summaryText, 'utf8');
    console.error(`[#001] Result written to ${process.argv[outIdx + 1]}`);
  }
  const csvOutIdx = process.argv.indexOf('--csv-out');
  if (csvOutIdx !== -1 && process.argv[csvOutIdx + 1]) {
    fs.writeFileSync(process.argv[csvOutIdx + 1], output.resultCsv, 'utf8');
    console.error(`[#001] Result CSV written to ${process.argv[csvOutIdx + 1]}`);
  }
}

main();
