'use strict';

const CLASSIFY_SYSTEM_PROMPT =
  'You are a structured data classifier. You output ONLY a single JSON object ' +
  'matching the schema the user describes. No markdown, no code fences, no commentary, ' +
  'no text before or after the JSON.';

const INTERPRET_SYSTEM_PROMPT =
  'You are a product feedback analyst. You output ONLY a single JSON object matching ' +
  'the schema the user describes. No markdown, no code fences, no commentary. You must ' +
  'only reference the theme_id values given to you — never invent new ones, never invent ' +
  'review content, never state a mention count (counts are supplied by the caller and must ' +
  'not be repeated or altered).';

function buildClassifyPrompt(reviews) {
  const payload = reviews.map((r) => ({ id: r.id, review: r.review }));
  return (
    'Classify each customer review below.\n\n' +
    'For each review, determine:\n' +
    '- category: exactly one of "praise", "complaint", "request", "neutral"\n' +
    '- theme: a short 2-5 word label for the specific topic, ALWAYS written in Korean ' +
    'regardless of what language the review itself is in (e.g. "배송 속도", "포장 품질", ' +
    '"앱 충돌"). Use the SAME Korean theme label (verbatim) for reviews that describe the ' +
    'same underlying topic, so they can be grouped later.\n\n' +
    'Return strictly this JSON shape and nothing else:\n' +
    '{"classifications":[{"id": <number>, "category": "<praise|complaint|request|neutral>", "theme": "<short label>"}]}\n\n' +
    'Every id below must appear exactly once in your response. Do not include review text ' +
    'in your response, only id/category/theme.\n\n' +
    `Reviews:\n${JSON.stringify(payload)}`
  );
}

function buildInterpretPrompt({ insightThemes, actionThemes }) {
  const forInsights = insightThemes.map((t) => ({
    theme_id: t.theme_id,
    category: t.category,
    theme: t.theme,
    mention_count: t.mention_count,
    evidence: t.evidence.map((e) => e.text),
  }));
  const forActions = actionThemes.map((t) => ({
    theme_id: t.theme_id,
    theme: t.theme,
    mention_count: t.mention_count,
    evidence: t.evidence.map((e) => e.text),
  }));

  return (
    'You are given aggregated review themes (already counted and grouped by code — ' +
    'do not recompute or restate counts).\n\n' +
    'Write ALL output text in Korean, regardless of what language the evidence text below ' +
    'is written in. The evidence is for your understanding only — never quote, translate, ' +
    'or reproduce it in your output.\n\n' +
    'TASK 1 — for every theme in INSIGHT_THEMES, write one plain Korean sentence ' +
    'summarizing what customers are saying about it, grounded only in the evidence text given.\n\n' +
    'TASK 2 — for every theme in ACTION_THEMES, write in Korean:\n' +
    '- why_it_matters: one Korean sentence on why this matters to the business\n' +
    '- recommended_action: one concrete, specific Korean sentence describing the action to take\n\n' +
    'Return strictly this JSON shape and nothing else:\n' +
    '{"insights":[{"theme_id":"<id>","sentence":"<...>"}],' +
    '"actions":[{"theme_id":"<id>","why_it_matters":"<...>","recommended_action":"<...>"}]}\n\n' +
    'You must cover every theme_id given below exactly once in the relevant array, and no others.\n\n' +
    `INSIGHT_THEMES:\n${JSON.stringify(forInsights)}\n\n` +
    `ACTION_THEMES:\n${JSON.stringify(forActions)}`
  );
}

function validateInterpretation(response, expectedInsightIds, expectedActionIds) {
  if (!response || !Array.isArray(response.insights) || !Array.isArray(response.actions)) {
    throw new Error('AI_SCHEMA_INVALID: insights/actions missing or not arrays');
  }
  const insightMap = new Map();
  for (const i of response.insights) {
    if (typeof i.theme_id !== 'string' || typeof i.sentence !== 'string' || i.sentence.trim() === '') {
      throw new Error(`AI_SCHEMA_INVALID: malformed insight entry ${JSON.stringify(i)}`);
    }
    insightMap.set(i.theme_id, i.sentence.trim());
  }
  for (const id of expectedInsightIds) {
    if (!insightMap.has(id)) {
      throw new Error(`AI_SCHEMA_INVALID: missing insight for theme_id ${id}`);
    }
  }

  const actionMap = new Map();
  for (const a of response.actions) {
    if (
      typeof a.theme_id !== 'string' ||
      typeof a.why_it_matters !== 'string' || a.why_it_matters.trim() === '' ||
      typeof a.recommended_action !== 'string' || a.recommended_action.trim() === ''
    ) {
      throw new Error(`AI_SCHEMA_INVALID: malformed action entry ${JSON.stringify(a)}`);
    }
    actionMap.set(a.theme_id, { why_it_matters: a.why_it_matters.trim(), recommended_action: a.recommended_action.trim() });
  }
  for (const id of expectedActionIds) {
    if (!actionMap.has(id)) {
      throw new Error(`AI_SCHEMA_INVALID: missing action for theme_id ${id}`);
    }
  }

  return { insightMap, actionMap };
}

function topByCategory(themes, category, limit) {
  return themes.filter((t) => t.category === category).slice(0, limit);
}

function dedupThemes(themeLists) {
  const seen = new Map();
  for (const list of themeLists) {
    for (const t of list) seen.set(t.theme_id, t);
  }
  return [...seen.values()];
}

// Final structural Evidence integrity gate: every evidence review_id used in
// the assembled result must resolve to the EXACT original review text from
// the validated CSV input. This is redundant with how evidence was built
// (code-only, never AI-generated) but is checked explicitly here so a broken
// invariant fails loudly instead of shipping a bad result.
function verifyEvidenceIntegrity(result, reviews) {
  const byId = new Map(reviews.map((r) => [r.id, r.review]));
  for (const action of result.actions) {
    for (const ev of action.evidence) {
      const original = byId.get(ev.review_id);
      if (original === undefined) {
        throw new Error(`EVIDENCE_INTEGRITY_FAILURE: review_id ${ev.review_id} does not exist in input`);
      }
      if (original !== ev.text) {
        throw new Error(`EVIDENCE_INTEGRITY_FAILURE: review_id ${ev.review_id} text does not match input verbatim`);
      }
    }
  }
}

function assembleResult({ themes, likes, complaints, requests, watchOut, actionThemes, insightMap, actionMap }) {
  const toBullet = (t) => ({
    theme: t.theme,
    mention_count: t.mention_count,
    sentence: insightMap.get(t.theme_id),
  });

  return {
    likes: likes.map(toBullet),
    complaints: complaints.map(toBullet),
    requests: requests.map(toBullet),
    watch_out: watchOut.map(toBullet),
    actions: actionThemes.map((t) => {
      const a = actionMap.get(t.theme_id);
      return {
        problem: t.theme,
        mention_count: t.mention_count,
        why_it_matters: a.why_it_matters,
        evidence: t.evidence,
        recommended_action: a.recommended_action,
      };
    }),
  };
}

function renderMarkdown(result, { totalReviews, blankSkipped }) {
  const lines = [];
  lines.push('# 고객 리뷰 → 개선 Action Report');
  lines.push('');
  lines.push(`분석한 리뷰 수: ${totalReviews}건 (빈 리뷰 ${blankSkipped}건 제외)`);
  lines.push('');

  lines.push('## 1. 고객이 좋아하는 이유');
  if (result.likes.length === 0) lines.push('- (칭찬 관련 항목 없음)');
  for (const l of result.likes) lines.push(`- **${l.theme}** (${l.mention_count}건 언급) — ${l.sentence}`);
  lines.push('');

  lines.push('## 2. 반복되는 불만');
  if (result.complaints.length === 0) lines.push('- (불만 관련 항목 없음)');
  for (const l of result.complaints) lines.push(`- **${l.theme}** (${l.mention_count}건 언급) — ${l.sentence}`);
  lines.push('');

  lines.push('## 3. 고객이 원하는 것');
  if (result.requests.length === 0) lines.push('- (요청 관련 항목 없음)');
  for (const l of result.requests) lines.push(`- **${l.theme}** (${l.mention_count}건 언급) — ${l.sentence}`);
  lines.push('');

  lines.push('## 4. 주의해야 할 문제');
  if (result.watch_out.length === 0) lines.push('- (없음 — 상위 항목 외에 반복되는 저빈도 이슈 없음)');
  for (const l of result.watch_out) lines.push(`- **${l.theme}** (${l.mention_count}건 언급) — ${l.sentence}`);
  lines.push('');

  lines.push('## 5. 개선 Action TOP 5');
  if (result.actions.length === 0) lines.push('- (불만/요청 항목이 없어 제안할 Action 없음)');
  result.actions.forEach((a, idx) => {
    lines.push(`### ${idx + 1}. ${a.problem}`);
    lines.push(`- 언급 수: ${a.mention_count}건`);
    lines.push(`- 왜 중요한가: ${a.why_it_matters}`);
    lines.push(`- 실제 리뷰 근거:`);
    for (const e of a.evidence) {
      lines.push(`  - [review_id ${e.review_id}] "${e.text}"`);
    }
    lines.push(`- 추천 개선안: ${a.recommended_action}`);
    lines.push('');
  });

  return lines.join('\n');
}

module.exports = {
  CLASSIFY_SYSTEM_PROMPT,
  INTERPRET_SYSTEM_PROMPT,
  buildClassifyPrompt,
  buildInterpretPrompt,
  validateInterpretation,
  topByCategory,
  dedupThemes,
  verifyEvidenceIntegrity,
  assembleResult,
  renderMarkdown,
};
