'use strict';

const { toCsv } = require('./csv');

const INTERPRET_SYSTEM_PROMPT =
  'You are a customer-support triage assistant. You output ONLY a single JSON object matching ' +
  'the schema the user describes. No markdown, no code fences, no commentary. You must cover ' +
  'every id given to you exactly once and invent no new ids. Never state a fact that is not ' +
  'present in the inquiry text: do not invent order numbers, dates, refund amounts, shipping ' +
  'carriers, policies, or promises about when something will be resolved. Never state or change ' +
  'a priority, score, or ranking — those are decided by the caller. Write every output field in ' +
  'Korean, in polite 고객 응대 tone (합니다/드립니다체).';

// CODE has already decided WHAT is urgent and in WHAT order. The AI only
// labels and drafts text; we never read a number back out of its response.
function buildInterpretPrompt(records) {
  const payload = records.map((r) => ({
    id: r.id,
    고객명: r.customer,
    채널: r.channel,
    주문번호: r.orderNo || null,
    접수일: r.receivedAt,
    현재상태: r.status,
    문의내용: r.content,
    담당자메모: r.note || null,
  }));

  return (
    '아래는 고객 문의 목록입니다. 각 문의에 대해 다음 네 가지를 작성하세요.\n\n' +
    '1. category: 문의 분류를 짧은 한국어 명사구로 (예: "배송 지연", "환불 요청", "제품 불량", ' +
    '"교환 문의", "결제 오류", "상품 문의", "단순 문의")\n' +
    '2. sentiment: 고객의 감정/불만 신호를 짧은 한국어로 (예: "강한 불만", "불만", "답답함", ' +
    '"중립", "긍정"). 문의내용에 드러난 것만 쓰고 추측하지 마세요.\n' +
    '3. nextAction: 담당자가 다음에 할 구체적인 행동 한 문장 (예: "물류팀에 송장번호 확인 후 ' +
    '고객에게 회신"). 원문에 없는 사실을 만들지 마세요.\n' +
    '4. replyDraft: 고객에게 그대로 보낼 수 있는 답변 초안 2~4문장. 반드시 지킬 것:\n' +
    '   - 원문에 없는 사실(주문번호, 날짜, 금액, 택배사, 정확한 처리 기한, 보상 약속)을 만들지 않는다\n' +
    '   - 확인이 필요한 부분은 "확인 후 안내드리겠습니다"처럼 확인 예정으로 쓴다\n' +
    '   - 고객명을 알면 "OOO님" 으로 시작한다\n\n' +
    'Return strictly this JSON shape and nothing else:\n' +
    '{"items":[{"id":<number>,"category":"<...>","sentiment":"<...>","nextAction":"<...>","replyDraft":"<...>"}]}\n\n' +
    `문의 목록:\n${JSON.stringify(payload, null, 1)}`
  );
}

function validateInterpretation(response, expectedIds) {
  if (!response || !Array.isArray(response.items)) {
    throw new Error('AI_SCHEMA_INVALID: items missing or not an array');
  }
  const map = new Map();
  for (const it of response.items) {
    if (
      typeof it.id !== 'number' ||
      typeof it.category !== 'string' || it.category.trim() === '' ||
      typeof it.sentiment !== 'string' || it.sentiment.trim() === '' ||
      typeof it.nextAction !== 'string' || it.nextAction.trim() === '' ||
      typeof it.replyDraft !== 'string' || it.replyDraft.trim() === ''
    ) {
      throw new Error(`AI_SCHEMA_INVALID: malformed item ${JSON.stringify(it)}`);
    }
    map.set(it.id, {
      category: it.category.trim(),
      sentiment: it.sentiment.trim(),
      nextAction: it.nextAction.trim(),
      replyDraft: it.replyDraft.trim(),
    });
  }
  for (const id of expectedIds) {
    if (!map.has(id)) throw new Error(`AI_SCHEMA_INVALID: missing item for id ${id}`);
  }
  return map;
}

// Merges CODE truth (score/grade/reasons/order) with AI text. Numbers only
// ever come from the left side.
function assembleResult(sortedRecords, aiMap) {
  return sortedRecords.map((r) => {
    const ai = aiMap.get(r.id);
    return {
      id: r.id,
      rowNumber: r.rowNumber,
      receivedAt: r.receivedAt,
      customer: r.customer,
      channel: r.channel,
      orderNo: r.orderNo,
      content: r.content,
      status: r.status,
      note: r.note,
      score: r.score,
      grade: r.grade,
      elapsedDays: r.elapsedDays,
      reasons: r.reasons,
      category: ai.category,
      sentiment: ai.sentiment,
      nextAction: ai.nextAction,
      replyDraft: ai.replyDraft,
    };
  });
}

// Plain text summary — pasteable into Slack/KakaoTalk/email as-is.
function renderSummaryText(summary, items) {
  const lines = [];
  lines.push('[문의 처리 요약]');
  lines.push(`- 전체 ${summary.total}건 / 긴급 ${summary.urgent}건 / 높음 ${summary.high}건 / 미처리 ${summary.open}건`);
  lines.push('');
  lines.push('[우선 처리 TOP 5]');
  const top = items.slice(0, 5);
  if (top.length === 0) {
    lines.push('- 없음');
  } else {
    top.forEach((it, i) => {
      lines.push(`${i + 1}. [${it.grade}] ${it.customer || '고객'} · ${it.category} (${it.receivedAt}, ${it.channel})`);
      lines.push(`   문의: ${it.content}`);
      lines.push(`   다음 행동: ${it.nextAction}`);
    });
  }
  lines.push('');
  lines.push('[전체 목록]');
  items.forEach((it, i) => {
    lines.push(`${i + 1}. [${it.grade}/${it.score}점] ${it.customer || '고객'} · ${it.category} · ${it.status || '상태 미기재'}`);
  });
  return lines.join('\n');
}

const RESULT_CSV_HEADER = [
  '우선순위', '등급', '점수', '접수일', '경과일', '고객명', '채널', '주문번호',
  '문의분류', '감정신호', '현재상태', '문의내용', '판단근거', '다음행동', '답변초안',
];

function renderResultCsv(items) {
  const rows = items.map((it, i) => [
    i + 1,
    it.grade,
    it.score,
    it.receivedAt,
    it.elapsedDays,
    it.customer,
    it.channel,
    it.orderNo,
    it.category,
    it.sentiment,
    it.status,
    it.content,
    it.reasons.join(' / '),
    it.nextAction,
    it.replyDraft,
  ]);
  return toCsv(RESULT_CSV_HEADER, rows);
}

module.exports = {
  INTERPRET_SYSTEM_PROMPT,
  buildInterpretPrompt,
  validateInterpretation,
  assembleResult,
  renderSummaryText,
  renderResultCsv,
};
