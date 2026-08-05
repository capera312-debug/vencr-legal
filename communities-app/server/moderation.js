// Moderation thresholds and a minimal banned-content filter.
//
// The word list below is intentionally short and illustrative — it catches
// the most obvious cases so the mechanism can be demonstrated end to end,
// it is NOT a real moderation solution. Before any real launch this should
// be replaced with a maintained list (or a moderation API/vendor) and,
// more importantly, backed by human review — see the report/auto-hide
// pipeline in index.js, which is blunt on purpose (documented in README).
const BANNED_PATTERNS = [
  /\bputo?a?s?\b/i,
  /\bmierda\b/i,
  /\bimb[eé]cil(es)?\b/i,
  /\bte voy a matar\b/i,
  /\bhijo de puta\b/i,
];

function containsBannedContent(text) {
  return BANNED_PATTERNS.some((re) => re.test(text));
}

// A comment/ad gets auto-hidden once distinct anonymous reporters reach
// this count. Low on purpose for the prototype so the flow is easy to
// demo — see README for why this is a blunt instrument (review-bombing
// risk) and what a real launch needs instead.
const REPORT_HIDE_THRESHOLD = 3;

// An anonymous identity whose comments get auto-hidden this many times is
// blocked from posting further. Rotating to a new incognito profile resets
// this — a known, documented limitation of any anonymous-by-design system.
const IDENTITY_BLOCK_THRESHOLD = 5;

module.exports = { containsBannedContent, REPORT_HIDE_THRESHOLD, IDENTITY_BLOCK_THRESHOLD };
