#!/usr/bin/env node
'use strict';

// Minimal local web surface for #006. Node's built-in `http` only — no
// framework, no router, no static-file middleware.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { runPipeline, PipelineError } = require('./lib/core');

const PORT = process.env.PORT || 4006;
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const INDEX_HTML_PATH = path.join(__dirname, 'public', 'index.html');
const SAMPLE_CSV_PATH = path.join(__dirname, 'fixtures', 'sample-inventory.csv');

const USER_MESSAGES = {
  EMPTY_FILE: null,
  NO_DATA_ROWS: null,
  NO_USABLE_ROWS: null,
  MISSING_COLUMNS: null,
  AMBIGUOUS_COLUMNS: null,
  TOO_MANY_ROWS: null,
  FILE_TOO_LARGE: 'CSV 파일이 5MB를 초과했습니다.',
};

function userMessage(code, fallbackMessage) {
  const mapped = USER_MESSAGES[code];
  if (mapped === undefined) return '분석 중 예상치 못한 오류가 발생했습니다.';
  return mapped === null ? fallbackMessage : mapped;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

// Exported so the AI-WORK shell can mount this handler under /006 — pure
// transport-layer detail, no business logic here.
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

  // Served straight from disk (instead of a copy embedded in the page) so
  // the downloaded bytes are byte-identical to the fixture the parser is
  // tested against — BOM and CRLF included.
  if (req.method === 'GET' && req.url === '/sample.csv') {
    fs.readFile(SAMPLE_CSV_PATH, (err, buf) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Failed to load sample.');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sample-inventory.csv"',
      });
      res.end(buf);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/analyze') {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;

    // Raw Buffer chunks decoded ONCE at the end — decoding per chunk
    // corrupts multi-byte UTF-8 characters split across TCP boundaries
    // (the bug found and fixed in #003).
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
          items: output.items,
          top5: output.top5,
          supplierGroups: output.supplierGroups,
          rowIssues: output.rowIssues,
          aiDegraded: output.aiDegraded,
          summaryText: output.summaryText,
          resultCsv: output.resultCsv,
        });
      } catch (e) {
        const code = e instanceof PipelineError ? e.code : 'UNEXPECTED_ERROR';
        console.error(`[#006 server] ${code}: ${e.message}`);
        sendJson(res, 200, { ok: false, code, message: userMessage(code, e.message) });
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
    console.log(`[#006] Server running at http://localhost:${PORT}`);
  });
}

module.exports = { requestListener };
