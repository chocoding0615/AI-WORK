#!/usr/bin/env node
'use strict';

// Minimal local web surface for #001. Node's built-in `http` only — no
// framework, no router, no static-file middleware. One page, one endpoint.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { runPipeline, PipelineError } = require('./lib/core');

const PORT = process.env.PORT || 4001;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // generous for <=300 short reviews
const INDEX_HTML_PATH = path.join(__dirname, 'public', 'index.html');

const USER_MESSAGES = {
  EMPTY_FILE: 'CSV 파일에 내용이 없습니다.',
  MISSING_REVIEW_COLUMN: '필수 컬럼(review)이 없습니다. CSV 헤더를 확인해주세요.',
  EMPTY_REVIEWS: '분석할 수 있는 리뷰가 없습니다. review 값이 비어있지 않은지 확인해주세요.',
  OVER_LIMIT: '리뷰가 300개를 초과했습니다. 300개 이하로 줄여서 다시 시도해주세요.',
  FILE_TOO_LARGE: '파일이 너무 큽니다.',
  AI_CLASSIFY_CALL_FAILED: 'AI 분석 호출에 실패했습니다. 잠시 후 다시 시도해주세요.',
  AI_CLASSIFY_SCHEMA_INVALID: 'AI 응답을 처리하는 중 문제가 발생했습니다. 다시 시도해주세요.',
  AI_INTERPRET_CALL_FAILED: 'AI 분석 호출에 실패했습니다. 잠시 후 다시 시도해주세요.',
  AI_INTERPRET_SCHEMA_INVALID: 'AI 응답을 처리하는 중 문제가 발생했습니다. 다시 시도해주세요.',
  EVIDENCE_INTEGRITY_FAILURE: '결과 검증에 실패했습니다. 다시 시도해주세요.',
};

function userMessage(code) {
  return USER_MESSAGES[code] || '분석 중 예상치 못한 오류가 발생했습니다.';
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

// Exported so the AI-WORK shell (repo-root server.js) can mount this same
// handler under a path prefix (e.g. /001/*) — a pure transport-layer detail,
// no business logic here changed. Standalone use (`node server.js`) is
// unaffected: see the require.main guard on server.listen() below.
function requestListener(req, res) {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(INDEX_HTML_PATH, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Failed to load page.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    return;
  }

  // Sample input, served straight from the fixture the pipeline is tested
  // against, so the download and the analyzer never drift apart.
  if (req.method === 'GET' && req.url === '/sample.csv') {
    fs.readFile(path.join(__dirname, 'fixtures', 'sample-reviews.csv'), (err, buf) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Failed to load sample.');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sample-reviews.csv"',
      });
      res.end(buf);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/analyze') {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;

    // Accumulate raw Buffer chunks and decode ONCE at the end. Decoding each
    // chunk individually (`body += chunk`, which calls chunk.toString('utf8')
    // per chunk) corrupts any multi-byte UTF-8 character (e.g. Korean, 3
    // bytes each) that happens to be split across two TCP chunks — both
    // halves independently fail to decode and become U+FFFD.
    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        tooLarge = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (tooLarge) {
        sendJson(res, 200, { ok: false, code: 'FILE_TOO_LARGE', message: userMessage('FILE_TOO_LARGE') });
        return;
      }
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        const output = runPipeline(body);
        sendJson(res, 200, {
          ok: true,
          summary: output.summary,
          result: output.result,
          reviewDetails: output.reviewDetails,
          rowIssues: output.rowIssues,
          summaryText: output.summaryText,
          resultCsv: output.resultCsv,
        });
      } catch (e) {
        const code = e instanceof PipelineError ? e.code : 'UNEXPECTED_ERROR';
        // Full detail stays server-side only — the client never sees raw
        // stack traces or internal AI-provider output.
        console.error(`[#001 server] ${code}: ${e.message}`);
        sendJson(res, 200, { ok: false, code, message: userMessage(code) });
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found.');
}

const server = http.createServer(requestListener);

// Only bind the port when this file is run directly (`node server.js`) —
// when required by the shell, only `requestListener` is used.
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[#001] Server running at http://localhost:${PORT}`);
  });
}

module.exports = { requestListener };
