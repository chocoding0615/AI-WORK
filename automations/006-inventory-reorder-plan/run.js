#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { runPipeline, PipelineError } = require('./lib/core');

function fail(code, message) {
  console.error(`[#006 FAILED] ${code}: ${message}`);
  process.exit(1);
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) fail('MISSING_ARG', 'Usage: node run.js <path-to-inventory.csv> [--out <path>]');

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
  console.error(
    `[#006] 전체 ${s.total}건 / 즉시 발주 ${s.immediate}건 / 발주 검토 ${s.review}건 / 정상 ${s.normal}건 / ` +
    `예상 발주금액 ${s.expectedOrderTotal.toLocaleString('ko-KR')}원`
  );
  for (const issue of output.rowIssues) console.error(`[#006] 경고 — ${issue}`);
  if (output.aiDegraded) console.error('[#006] AI 설명 일부를 생성하지 못해 기본 문안을 표시했습니다.');

  console.log(output.summaryText);

  const outIdx = process.argv.indexOf('--out');
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    fs.writeFileSync(process.argv[outIdx + 1], output.resultCsv, 'utf8');
    console.error(`[#006] 결과 CSV 저장: ${process.argv[outIdx + 1]}`);
  }
}

main();
