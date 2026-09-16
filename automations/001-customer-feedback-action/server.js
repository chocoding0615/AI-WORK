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

const server = http.createServer((req, res) => {
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
        sendJson(res, 200, { ok: true, markdown: output.markdown, result: output.result, meta: output.meta });
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
});

server.listen(PORT, () => {
  console.log(`[#001] Server running at http://localhost:${PORT}`);
});
