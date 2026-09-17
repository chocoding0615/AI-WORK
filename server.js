#!/usr/bin/env node
'use strict';

// AI-WORK Shell: a single :4001 entry point that gives access to each
// independent Automation. This is access/navigation convenience ONLY — it
// contains no business logic. Each automation's own lib/core.js and
// server.js remain fully independent and independently runnable; this file
// just mounts their existing exported requestListener under a path prefix.
//
// Adding #003 later = add one more explicit `if` block below (ROUTES). No
// registry, no auto-discovery, no generic router.
const http = require('http');
const fs = require('fs');
const path = require('path');

const { requestListener: automation001 } = require('./automations/001-customer-feedback-action/server');
const { requestListener: automation002 } = require('./automations/002-sales-anomaly-action/server');
const { requestListener: automation003 } = require('./automations/003-expense-recurring-cost/server');
const { requestListener: automation004 } = require('./automations/004-meeting-action/server');
const { requestListener: automation005 } = require('./automations/005-inquiry-priority-reply/server');

const PORT = process.env.PORT || 4001;
const SHELL_HTML_PATH = path.join(__dirname, 'shell', 'index.html');

// Explicit hardcoded mapping (section 7: no intelligent routing).
const ROUTES = [
  { prefix: '/001', handler: automation001 },
  { prefix: '/002', handler: automation002 },
  { prefix: '/003', handler: automation003 },
  { prefix: '/004', handler: automation004 },
  { prefix: '/005', handler: automation005 },
];

function serveShell(res) {
  fs.readFile(SHELL_HTML_PATH, 'utf8', (err, html) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Failed to load shell.');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    serveShell(res);
    return;
  }

  for (const route of ROUTES) {
    if (req.url === route.prefix && req.method === 'GET') {
      // Canonicalize to the trailing-slash form so the automation page's
      // relative fetch('analyze') resolves correctly.
      res.writeHead(302, { Location: `${route.prefix}/` });
      res.end();
      return;
    }
    if (req.url === `${route.prefix}/` || req.url.startsWith(`${route.prefix}/`)) {
      const rest = req.url.slice(route.prefix.length) || '/';
      req.url = rest.startsWith('/') ? rest : `/${rest}`;
      route.handler(req, res);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found.');
});

server.listen(PORT, () => {
  console.log(`[AI-WORK Shell] Server running at http://localhost:${PORT}`);
});
