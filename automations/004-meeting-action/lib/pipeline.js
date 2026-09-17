'use strict';

const UNKNOWN_LABEL = '확인 필요';

const SYSTEM_PROMPT =
  'You are a meeting-notes structurer. You output ONLY a single JSON object matching the ' +
  'schema the user describes. No markdown, no code fences, no commentary. Extract only what ' +
  'is explicitly stated in the text: never invent an owner or due date that is not present in ' +
  'the text (use null instead), and never convert a relative date/time expression (e.g. ' +
  '"다음 주 금요일", "이번 주", "내일까지") into an absolute calendar date — preserve the ' +
  'original wording verbatim. Only classify something as a decision if the text states it was ' +
  'decided/confirmed/finalized; something merely discussed or proposed without a stated decision ' +
  'belongs in openIssues instead, never in decisions. All output text must be in Korean.';

function buildPrompt(meetingText) {
  return (
    '아래는 회의록/회의 녹취 텍스트입니다. 다음 세 범주로만 구조화해서 추출하세요. 일반적인 ' +
    '회의 요약문을 쓰지 마세요.\n\n' +
    '1. decisions: 명시적으로 결정/확정되었다고 말한 내용만 (논의만 되고 결정되지 않은 것은 제외)\n' +
    '2. actions: 실제로 누군가 수행해야 하는 업무. 각 항목은 task(할 일), owner(담당자), ' +
    'dueDate(기한) 세 필드를 가짐.\n' +
    '   - 원문에 담당자가 명시되지 않았다면 owner는 반드시 null로 반환한다 (추측 금지)\n' +
    '   - 원문에 기한이 명시되지 않았다면 dueDate는 반드시 null로 반환한다 (추측 금지)\n' +
    '   - dueDate는 원문 표현을 그대로 보존한다 (예: "다음 주 금요일", "이번 주") — ' +
    '"2026-09-25" 같은 실제 날짜로 변환하지 않는다\n' +
    '3. openIssues: 아직 결정되지 않았거나 추가 확인이 필요한 사항\n\n' +
    '해당하는 내용이 없는 범주는 빈 배열 []로 반환한다 (오류 아님).\n\n' +
    'Return strictly this JSON shape and nothing else:\n' +
    '{"decisions":[{"content":"<...>"}],' +
    '"actions":[{"task":"<...>","owner":"<...> 또는 null","dueDate":"<...> 또는 null"}],' +
    '"openIssues":[{"content":"<...>"}]}\n\n' +
    `회의 내용:\n${meetingText}`
  );
}

function validateResponse(response) {
  if (
    !response ||
    !Array.isArray(response.decisions) ||
    !Array.isArray(response.actions) ||
    !Array.isArray(response.openIssues)
  ) {
    throw new Error('AI_SCHEMA_INVALID: decisions/actions/openIssues missing or not arrays');
  }

  const decisions = response.decisions.map((d, i) => {
    if (typeof d.content !== 'string' || d.content.trim() === '') {
      throw new Error(`AI_SCHEMA_INVALID: malformed decision at index ${i}`);
    }
    return { content: d.content.trim() };
  });

  const actions = response.actions.map((a, i) => {
    if (typeof a.task !== 'string' || a.task.trim() === '') {
      throw new Error(`AI_SCHEMA_INVALID: malformed action at index ${i}`);
    }
    const owner = typeof a.owner === 'string' && a.owner.trim() !== '' ? a.owner.trim() : null;
    const dueDate = typeof a.dueDate === 'string' && a.dueDate.trim() !== '' ? a.dueDate.trim() : null;
    return { task: a.task.trim(), owner, dueDate };
  });

  const openIssues = response.openIssues.map((o, i) => {
    if (typeof o.content !== 'string' || o.content.trim() === '') {
      throw new Error(`AI_SCHEMA_INVALID: malformed openIssue at index ${i}`);
    }
    return { content: o.content.trim() };
  });

  return { decisions, actions, openIssues };
}

// Plain text, safe to paste into Slack/KakaoTalk/email — no markdown table
// syntax that would render as garbage in those tools.
function renderPlainText(result) {
  const lines = [];

  lines.push('[결정사항]');
  if (result.decisions.length === 0) {
    lines.push('- 없음');
  } else {
    for (const d of result.decisions) lines.push(`- ${d.content}`);
  }
  lines.push('');

  lines.push('[해야 할 일]');
  if (result.actions.length === 0) {
    lines.push('- 없음');
  } else {
    for (const a of result.actions) {
      lines.push(`- ${a.task} / ${a.owner || UNKNOWN_LABEL} / ${a.dueDate || UNKNOWN_LABEL}`);
    }
  }
  lines.push('');

  lines.push('[확인 필요]');
  if (result.openIssues.length === 0) {
    lines.push('- 없음');
  } else {
    for (const o of result.openIssues) lines.push(`- ${o.content}`);
  }

  return lines.join('\n');
}

module.exports = { SYSTEM_PROMPT, buildPrompt, validateResponse, renderPlainText, UNKNOWN_LABEL };
