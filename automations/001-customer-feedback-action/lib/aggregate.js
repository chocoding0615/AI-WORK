'use strict';

const ALLOWED_CATEGORIES = new Set(['praise', 'complaint', 'request', 'neutral']);

// CODE OWNS: grouping, counting, sorting, evidence lookup. The AI only
// supplied a category + theme label per review id; every number and every
// piece of evidence text below comes directly from the validated input.
function aggregate(reviews, classifications) {
  const byId = new Map(reviews.map((r) => [r.id, r]));
  const groups = new Map();

  for (const c of classifications) {
    const key = `${c.category}::${c.theme.trim().toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, { category: c.category, theme: c.theme.trim(), reviewIds: [] });
    }
    groups.get(key).reviewIds.push(c.id);
  }

  const themes = [...groups.values()].map((g, idx) => {
    const evidence = g.reviewIds.slice(0, 3).map((id) => {
      const r = byId.get(id);
      return { review_id: id, text: r.review, rating: r.rating };
    });
    return {
      theme_id: `t${idx}`,
      category: g.category,
      theme: g.theme,
      mention_count: g.reviewIds.length,
      review_ids: g.reviewIds,
      evidence,
    };
  });

  themes.sort((a, b) => b.mention_count - a.mention_count);
  return themes;
}

function validateClassification(response, reviews) {
  if (!response || !Array.isArray(response.classifications)) {
    throw new Error('AI_SCHEMA_INVALID: classifications missing or not an array');
  }
  const validIds = new Set(reviews.map((r) => r.id));
  const seen = new Set();
  for (const c of response.classifications) {
    if (typeof c.id !== 'number' || !validIds.has(c.id)) {
      throw new Error(`AI_SCHEMA_INVALID: classification references unknown review id ${JSON.stringify(c.id)}`);
    }
    if (!ALLOWED_CATEGORIES.has(c.category)) {
      throw new Error(`AI_SCHEMA_INVALID: unknown category "${c.category}" for review id ${c.id}`);
    }
    if (typeof c.theme !== 'string' || c.theme.trim().length === 0) {
      throw new Error(`AI_SCHEMA_INVALID: missing theme for review id ${c.id}`);
    }
    seen.add(c.id);
  }
  for (const id of validIds) {
    if (!seen.has(id)) {
      throw new Error(`AI_SCHEMA_INVALID: review id ${id} was not classified`);
    }
  }
}

module.exports = { aggregate, validateClassification, ALLOWED_CATEGORIES };
