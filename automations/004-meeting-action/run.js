#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { runPipeline, PipelineError } = require('./lib/core');

function fail(code, message) {
  console.error(`[#004 FAILED] ${code}: ${message}`);
  process.exit(1);
}

function main() {
  const textPath = process.argv[2];
  if (!textPath) fail('MISSING_ARG', 'Usage: node run.js <path-to-meeting.txt>');

  let text;
  try {
    text = fs.readFileSync(textPath, 'utf8');
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

  console.error(`[#004] decisions=${output.result.decisions.length}, actions=${output.result.actions.length}, openIssues=${output.result.openIssues.length}`);
  if (output.meta.costUsd != null) {
    console.error(`[#004] AI call ok (cost: $${output.meta.costUsd}).`);
  }

  console.log(output.plainText);

  const csvOutIdx = process.argv.indexOf('--csv-out');
  if (csvOutIdx !== -1 && process.argv[csvOutIdx + 1]) {
    fs.writeFileSync(process.argv[csvOutIdx + 1], output.resultCsv, 'utf8');
    console.error(`[#004] Result CSV written to ${process.argv[csvOutIdx + 1]}`);
  }
}

main();
