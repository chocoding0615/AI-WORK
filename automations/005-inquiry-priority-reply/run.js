#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { runPipeline, PipelineError } = require('./lib/core');

function fail(code, message) {
  console.error(`[#005 FAILED] ${code}: ${message}`);
  process.exit(1);
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) fail('MISSING_ARG', 'Usage: node run.js <path-to-inquiries.csv> [--out <path>]');

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

  const s = output.summary;
  console.error(`[#005] 전체 ${s.total}건 / 긴급 ${s.urgent}건 / 높음 ${s.high}건 / 미처리 ${s.open}건`);
  for (const issue of output.rowIssues) console.error(`[#005] 경고 — ${issue}`);
  if (output.meta.costUsd != null) console.error(`[#005] AI call ok (cost: $${output.meta.costUsd}).`);

  console.log(output.summaryText);

  const outIdx = process.argv.indexOf('--out');
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    fs.writeFileSync(process.argv[outIdx + 1], output.resultCsv, 'utf8');
    console.error(`[#005] 결과 CSV 저장: ${process.argv[outIdx + 1]}`);
  }
}

main();
