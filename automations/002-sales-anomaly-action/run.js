#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { runPipeline, PipelineError } = require('./lib/core');

function fail(code, message) {
  console.error(`[#002 FAILED] ${code}: ${message}`);
  process.exit(1);
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) fail('MISSING_ARG', 'Usage: node run.js <path-to-sales.csv> [--out <path>]');

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

  console.error(`[#002] 비교 기간 — 이전: ${output.periods.previous.start}~${output.periods.previous.end}, 현재: ${output.periods.current.start}~${output.periods.current.end}`);
  console.error(`[#002] 분석 상품 수: ${output.productsAnalyzed}, 이상 탐지 건수: ${output.anomalies.length}`);
  if (output.meta.interpretCostUsd != null) {
    console.error(`[#002] AI interpretation call ok (cost: $${output.meta.interpretCostUsd}).`);
  }

  console.log(output.markdown);

  const outIdx = process.argv.indexOf('--out');
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    fs.writeFileSync(process.argv[outIdx + 1], output.markdown, 'utf8');
    console.error(`[#002] Result written to ${process.argv[outIdx + 1]}`);
  }
}

main();
