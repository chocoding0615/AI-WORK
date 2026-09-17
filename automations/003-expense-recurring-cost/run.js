#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { runPipeline, PipelineError } = require('./lib/core');

function fail(code, message) {
  console.error(`[#003 FAILED] ${code}: ${message}`);
  process.exit(1);
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) fail('MISSING_ARG', 'Usage: node run.js <path-to-expenses.csv> [--out <path>]');

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

  console.error(`[#003] 분석 기간: ${output.summary.analyzedPeriod.start} ~ ${output.summary.analyzedPeriod.end}`);
  console.error(`[#003] 총 거래 수: ${output.summary.totalTransactions}, 월 반복 지출 후보 수: ${output.summary.recurringCandidateCount}`);
  if (output.meta.interpretCostUsd != null) {
    console.error(`[#003] AI interpretation call ok (cost: $${output.meta.interpretCostUsd}).`);
  }

  console.log(output.markdown);

  const outIdx = process.argv.indexOf('--out');
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    fs.writeFileSync(process.argv[outIdx + 1], output.markdown, 'utf8');
    console.error(`[#003] Result written to ${process.argv[outIdx + 1]}`);
  }
}

main();
