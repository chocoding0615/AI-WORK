#!/usr/bin/env node
'use strict';

// Minimal local web surface for #004. Node's built-in `http` only — no
// framework, no router, no static-file middleware. One page, one endpoint.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { runPipeline, PipelineError } = require('./lib/core');

const PORT = process.env.PORT || 4004;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // generous for a pasted meeting transcript
const INDEX_HTML_PATH = path.join(__dirname, 'public', 'index.html');

const USER_MESSAGES = {
  EMPTY_INPUT: '회의 내용을 입력해주세요.',
  AI_CALL_FAILED: 'AI 분석 호출에 실패했습니다. 잠시 후 다시 시도해주세요.',
  AI_SCHEMA_INVALID: 'AI 응답을 처리하는 중 문제가 발생했습니다. 다시 시도해주세요.',
  FILE_TOO_LARGE: '입력 내용이 너무 큽니다.',
  INVALID_REQUEST: '요청 형식이 올바르지 않습니다.',
};

function userMessage(code) {
  return USER_MESSAGES[code] || '분석 중 예상치 못한 오류가 발생했습니다.';
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

// Exported so a future shell could mount this same handler under a path
// prefix — a pure transport-layer detail, no business logic here. Standalone
// use (`node server.js`) is unaffected: see the require.main guard below.
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

  if (req.method === 'POST' && req.url === '/analyze') {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;

    // Accumulate raw Buffer chunks and decode ONCE at the end. Decoding each
    // chunk individually (`body += chunk`) corrupts any multi-byte UTF-8
    // character (Korean, 3 bytes each) split across two TCP chunks — the
    // exact bug already found and fixed in #003; applying the same pattern
    // here from the start instead of reproducing it.
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
      let parsedBody;
      try {
        parsedBody = JSON.parse(body);
      } catch (e) {
        sendJson(res, 200, { ok: false, code: 'INVALID_REQUEST', message: userMessage('INVALID_REQUEST') });
        return;
      }
      try {
        const output = runPipeline(parsedBody.text);
        sendJson(res, 200, { ok: true, result: output.result, plainText: output.plainText });
      } catch (e) {
        const code = e instanceof PipelineError ? e.code : 'UNEXPECTED_ERROR';
        // Full detail stays server-side only — the client never sees raw
        // stack traces or internal AI-provider output.
        console.error(`[#004 server] ${code}: ${e.message}`);
        sendJson(res, 200, { ok: false, code, message: userMessage(code) });
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found.');
}

const server = http.createServer(requestListener);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[#004] Server running at http://localhost:${PORT}`);
  });
}

module.exports = { requestListener };
