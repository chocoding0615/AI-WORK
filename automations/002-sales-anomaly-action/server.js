#!/usr/bin/env node
'use strict';

// Minimal local web surface for #002. Node's built-in `http` only — no
// framework, no router, no static-file middleware. One page, one endpoint.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { runPipeline, PipelineError } = require('./lib/core');

const PORT = process.env.PORT || 4002;
const MAX_BODY_BYTES = 6 * 1024 * 1024; // just above the 5MB CSV limit so the limit itself is the real gate
const INDEX_HTML_PATH = path.join(__dirname, 'public', 'index.html');

const USER_MESSAGES = {
  EMPTY_FILE: 'CSV 파일에 내용이 없습니다.',
  MISSING_COLUMN: null, // message already user-facing from schema.js
  AMBIGUOUS_COLUMN: null,
  INVALID_PRODUCT: null,
  INVALID_DATE: null,
  INVALID_NUMBER: null,
  NEGATIVE_SALES: null,
  NEGATIVE_QUANTITY: null,
  TOO_MANY_ROWS: null,
  FILE_TOO_LARGE: 'CSV 파일이 5MB를 초과했습니다.',
  INSUFFICIENT_RANGE: null,
  AI_INTERPRET_CALL_FAILED: 'AI 분석 호출에 실패했습니다. 잠시 후 다시 시도해주세요.',
  AI_INTERPRET_SCHEMA_INVALID: 'AI 응답을 처리하는 중 문제가 발생했습니다. 다시 시도해주세요.',
};

function userMessage(code, fallbackMessage) {
  const mapped = USER_MESSAGES[code];
  if (mapped === undefined) return '분석 중 예상치 못한 오류가 발생했습니다.';
  return mapped === null ? fallbackMessage : mapped;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

// Exported so the AI-WORK shell (repo-root server.js) can mount this same
// handler under a path prefix (e.g. /002/*) — a pure transport-layer detail,
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
    fs.readFile(path.join(__dirname, 'fixtures', 'sample-sales-kr.csv'), (err, buf) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Failed to load sample.');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sample-sales.csv"',
      });
      res.end(buf);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/analyze') {
    let body = '';
    let tooLarge = false;

    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        tooLarge = true;
        req.destroy();
      }
    });

    req.on('end', () => {
      if (tooLarge) {
        sendJson(res, 200, { ok: false, code: 'FILE_TOO_LARGE', message: userMessage('FILE_TOO_LARGE') });
        return;
      }
      try {
        const output = runPipeline(body);
        sendJson(res, 200, {
          ok: true,
          markdown: output.markdown,
          periods: output.periods,
          productsAnalyzed: output.productsAnalyzed,
          anomalies: output.anomalies,
        });
      } catch (e) {
        const code = e instanceof PipelineError ? e.code : 'UNEXPECTED_ERROR';
        // Full detail stays server-side only — the client never sees raw
        // stack traces or internal AI-provider output.
        console.error(`[#002 server] ${code}: ${e.message}`);
        sendJson(res, 200, { ok: false, code, message: userMessage(code, e.message) });
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
    console.log(`[#002] Server running at http://localhost:${PORT}`);
  });
}

module.exports = { requestListener };
