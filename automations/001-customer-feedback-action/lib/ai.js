'use strict';

const { spawnSync } = require('child_process');

// Single AI provider / single model path for #001: the already-authenticated
// local `claude` CLI, invoked non-interactively (`-p`). No API key is stored
// or required by this code; auth is whatever the environment's `claude` CLI
// already uses. No generic provider abstraction — this is the only call site.
//
// --system-prompt replaces the CLI's default system prompt (instead of
// appending to it) so the model only sees the minimal instructions below.
// --strict-mcp-config and --allowedTools "" ensure no tools/MCP servers are
// available — this call must only classify/interpret text, never act.
function callClaude({ systemPrompt, userPrompt, model }) {
  const args = [
    '-p', userPrompt,
    '--system-prompt', systemPrompt,
    '--model', model,
    '--strict-mcp-config',
    '--allowedTools', '',
    '--output-format', 'json',
  ];

  const proc = spawnSync('claude', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  if (proc.error) {
    throw new Error(`AI_CALL_FAILED: could not spawn claude CLI: ${proc.error.message}`);
  }
  if (proc.status !== 0) {
    throw new Error(`AI_CALL_NONZERO_EXIT: status=${proc.status} stderr=${proc.stderr || ''}`);
  }

  let envelope;
  try {
    envelope = JSON.parse(proc.stdout);
  } catch (e) {
    throw new Error(`AI_CALL_BAD_ENVELOPE: ${e.message}`);
  }

  if (envelope.is_error) {
    throw new Error(`AI_CALL_ERROR: ${envelope.result || 'unknown error from claude CLI'}`);
  }

  const text = envelope.result || '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`AI_RESPONSE_NO_JSON_OBJECT_FOUND: raw response was: ${text.slice(0, 500)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new Error(`AI_RESPONSE_NOT_JSON: ${e.message}`);
  }

  return { parsed, meta: { cost_usd: envelope.total_cost_usd, duration_ms: envelope.duration_ms } };
}

module.exports = { callClaude };
