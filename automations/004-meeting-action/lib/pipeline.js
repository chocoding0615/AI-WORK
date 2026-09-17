'use strict';

const UNKNOWN_LABEL = '미지정';
const CONFIRM_LABEL = '확인 필요';

const PRIORITY_KEYWORDS = ['긴급', '우선', '즉시', 'ASAP', '빨리', '최우선', '오늘까지', '당장'];

const SYSTEM_PROMPT =
  'You are a meeting-notes structurer. You output ONLY a single JSON object matching the ' +
  'schema the user describes. No markdown, no code fences, no commentary. Extract only what ' +
  'is explicitly stated in the text: never invent an owner or due date that is not present in ' +
  'the text (use null instead), and never convert a relative date/time expression (e.g. ' +
  '"다음 주 금요일", "이번 주", "내일까지") into an absolute calendar date — preserve the ' +
  'original wording verbatim. Only classify something as a decision if the text states it was ' +
  'decided/confirmed/finalized; something merely discussed or proposed without a stated decision ' +
  'belongs in openIssues instead, never in decisions. Every "evidence" field must be an EXACT ' +
  'substring copied verbatim from the source text — never paraphrase or reconstruct it. All ' +
  'other output text must be in Korean.';

function buildPrompt(meetingText) {
  return (
    '아래는 회의록/회의 녹취 텍스트입니다. 다음 세 범주로만 구조화해서 추출하세요. 일반적인 ' +
    '회의 요약문을 쓰지 마세요.\n\n' +
    '1. decisions: 명시적으로 결정/확정되었다고 말한 내용만 (논의만 되고 결정되지 않은 것은 제외). ' +
    '각 항목: content(결정 내용), evidence(그 결정의 근거가 된 원문 문장, 원문 그대로 정확히 복사), ' +
    'topic(관련 주제를 2-4단어로), impact(이 결정이 미치는 후속 영향 한 문장), ' +
    'followUpNeeded(추가 확인이 더 필요하면 true, 아니면 false)\n\n' +
    '2. actions: 실제로 누군가 수행해야 하는 업무. 각 항목: task(할 일), owner(담당자, 원문에 ' +
    '없으면 반드시 null), dueDate(기한, 원문 표현 그대로 보존, 원문에 없으면 반드시 null), ' +
    'status(원문에 진행 상태가 명시된 경우만 그 표현을 그대로, 없으면 반드시 null), ' +
    'evidence(그 할 일의 근거가 된 원문 문장, 원문 그대로 정확히 복사), ' +
    'nextAction(담당자가 완료를 위해 취해야 할 구체적 다음 행동 한 문장, 원문에 없는 사실은 만들지 않음)\n\n' +
    '3. openIssues: 아직 결정되지 않았거나 추가 확인이 필요한 사항. 각 항목: content(내용), ' +
    'evidence(근거가 된 원문 문장, 원문 그대로 정확히 복사), ' +
    'recommendedQuestion(이 사안을 해결하기 위해 물어야 할 구체적 질문 한 문장)\n\n' +
    '해당하는 내용이 없는 범주는 빈 배열 []로 반환한다 (오류 아님).\n\n' +
    'Return strictly this JSON shape and nothing else:\n' +
    '{"decisions":[{"content":"<...>","evidence":"<...>","topic":"<...>","impact":"<...>","followUpNeeded":<true|false>}],' +
    '"actions":[{"task":"<...>","owner":"<...> 또는 null","dueDate":"<...> 또는 null","status":"<...> 또는 null","evidence":"<...>","nextAction":"<...>"}],' +
    '"openIssues":[{"content":"<...>","evidence":"<...>","recommendedQuestion":"<...>"}]}\n\n' +
    `회의 내용:\n${meetingText}`
  );
}

// Every "evidence" string must appear verbatim in the source text. If it
// doesn't (AI drift, translation, light paraphrase), we do NOT trust it as a
// quote — we replace it with an explicit "not verified" marker rather than
// show a fabricated-looking citation. This never fails the whole pipeline;
// a bad quote on one item doesn't invalidate the others.
function verifyEvidence(evidence, sourceText) {
  if (typeof evidence !== 'string' || evidence.trim() === '') return null;
  const trimmed = evidence.trim();
  return sourceText.includes(trimmed) ? trimmed : null;
}

// CODE-owned priority: a fixed keyword list over the task+evidence text,
// exactly the same "matched keyword" approach #005 uses for inquiries — not
// an AI guess.
function derivePriority(task, evidence) {
  const haystack = `${task} ${evidence || ''}`;
  return PRIORITY_KEYWORDS.some((k) => haystack.includes(k)) ? '높음' : '보통';
}

function validateResponse(response, sourceText) {
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
    const evidence = verifyEvidence(d.evidence, sourceText);
    return {
      content: d.content.trim(),
      evidence,
      evidenceVerified: evidence !== null,
      topic: typeof d.topic === 'string' && d.topic.trim() !== '' ? d.topic.trim() : UNKNOWN_LABEL,
      impact: typeof d.impact === 'string' && d.impact.trim() !== '' ? d.impact.trim() : CONFIRM_LABEL,
      followUpNeeded: d.followUpNeeded === true,
    };
  });

  const actions = response.actions.map((a, i) => {
    if (typeof a.task !== 'string' || a.task.trim() === '') {
      throw new Error(`AI_SCHEMA_INVALID: malformed action at index ${i}`);
    }
    const owner = typeof a.owner === 'string' && a.owner.trim() !== '' ? a.owner.trim() : null;
    const dueDate = typeof a.dueDate === 'string' && a.dueDate.trim() !== '' ? a.dueDate.trim() : null;
    const status = typeof a.status === 'string' && a.status.trim() !== '' ? a.status.trim() : null;
    const evidence = verifyEvidence(a.evidence, sourceText);
    const nextAction = typeof a.nextAction === 'string' && a.nextAction.trim() !== '' ? a.nextAction.trim() : CONFIRM_LABEL;
    return {
      task: a.task.trim(),
      owner,
      dueDate,
      status,
      evidence,
      evidenceVerified: evidence !== null,
      nextAction,
      priority: derivePriority(a.task, evidence || ''),
    };
  });

  const openIssues = response.openIssues.map((o, i) => {
    if (typeof o.content !== 'string' || o.content.trim() === '') {
      throw new Error(`AI_SCHEMA_INVALID: malformed openIssue at index ${i}`);
    }
    const evidence = verifyEvidence(o.evidence, sourceText);
    const recommendedQuestion = typeof o.recommendedQuestion === 'string' && o.recommendedQuestion.trim() !== ''
      ? o.recommendedQuestion.trim() : CONFIRM_LABEL;
    return {
      content: o.content.trim(),
      evidence,
      evidenceVerified: evidence !== null,
      recommendedQuestion,
    };
  });

  return { decisions, actions, openIssues };
}

function computeSummary(result) {
  return {
    decisionsCount: result.decisions.length,
    actionsCount: result.actions.length,
    openIssuesCount: result.openIssues.length,
    unassignedOwnerCount: result.actions.filter((a) => a.owner === null).length,
    noDueDateCount: result.actions.filter((a) => a.dueDate === null).length,
    followUpCount: result.openIssues.length + result.decisions.filter((d) => d.followUpNeeded).length,
  };
}

// Plain text, safe to paste into Slack/KakaoTalk/email — no markdown table
// syntax that would render as garbage in those tools.
function renderPlainText(result, summary) {
  const lines = [];
  lines.push('[회의 정리 요약]');
  lines.push(`결정사항 ${summary.decisionsCount}건 / 할 일 ${summary.actionsCount}건 / 확인 필요 ${summary.openIssuesCount}건`);
  lines.push(`담당자 미지정 ${summary.unassignedOwnerCount}건 / 기한 미지정 ${summary.noDueDateCount}건 / 후속 확인 필요 ${summary.followUpCount}건`);
  lines.push('');

  lines.push('[결정사항]');
  if (result.decisions.length === 0) {
    lines.push('- 없음');
  } else {
    result.decisions.forEach((d) => {
      lines.push(`- ${d.content} (주제: ${d.topic})`);
      lines.push(`  근거: ${d.evidenceVerified ? d.evidence : '원문에서 정확히 일치하는 문장을 찾지 못함'}`);
      lines.push(`  후속 영향: ${d.impact}${d.followUpNeeded ? ' [추가 확인 필요]' : ''}`);
    });
  }
  lines.push('');

  lines.push('[해야 할 일]');
  if (result.actions.length === 0) {
    lines.push('- 없음');
  } else {
    result.actions.forEach((a) => {
      lines.push(`- [${a.priority}] ${a.task} / 담당: ${a.owner || UNKNOWN_LABEL} / 기한: ${a.dueDate || UNKNOWN_LABEL} / 상태: ${a.status || UNKNOWN_LABEL}`);
      lines.push(`  다음 행동: ${a.nextAction}`);
    });
  }
  lines.push('');

  lines.push('[확인 필요]');
  if (result.openIssues.length === 0) {
    lines.push('- 없음');
  } else {
    result.openIssues.forEach((o) => {
      lines.push(`- ${o.content}`);
      lines.push(`  권장 확인 질문: ${o.recommendedQuestion}`);
    });
  }

  return lines.join('\n');
}

// CSV export: one file, a 구분(category) column distinguishes the three
// kinds of rows so it stays a single simple download.
function escapeCsvValue(value) {
  const s = String(value == null ? '' : value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCsv(headerRow, dataRows) {
  const lines = [headerRow, ...dataRows].map((r) => r.map(escapeCsvValue).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const RESULT_CSV_HEADER = ['구분', '내용', '담당자', '기한', '상태/우선순위', '근거', '다음행동또는권장질문'];

function renderResultCsv(result) {
  const rows = [];
  for (const d of result.decisions) {
    rows.push(['결정', d.content, '', '', d.followUpNeeded ? '추가확인필요' : '', d.evidenceVerified ? d.evidence : '', d.impact]);
  }
  for (const a of result.actions) {
    rows.push(['할일', a.task, a.owner || UNKNOWN_LABEL, a.dueDate || UNKNOWN_LABEL, a.priority, a.evidenceVerified ? a.evidence : '', a.nextAction]);
  }
  for (const o of result.openIssues) {
    rows.push(['확인필요', o.content, '', '', '', o.evidenceVerified ? o.evidence : '', o.recommendedQuestion]);
  }
  return toCsv(RESULT_CSV_HEADER, rows);
}

module.exports = {
  SYSTEM_PROMPT,
  buildPrompt,
  validateResponse,
  computeSummary,
  renderPlainText,
  renderResultCsv,
  UNKNOWN_LABEL,
  CONFIRM_LABEL,
};
