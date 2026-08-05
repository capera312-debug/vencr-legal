// Zero-dependency JSON-file store. Good enough for a single-instance
// prototype; swap for a real database before scaling past one process.
const fs = require("fs");
const path = require("path");

const dataPath = process.env.DATA_PATH || path.join(__dirname, "..", "data.json");

function emptyState() {
  return {
    nextCommentId: 1,
    nextEntityId: 1,
    nextAdId: 1,
    nextReportId: 1,

    // anonymous individuals — never linked to a real identity
    identities: {}, // anonId -> { label, createdAt, blocked, hiddenCount }
    // communities are not created by anyone — they're derived from
    // location (see places.js) — so comments key on a placeId (string),
    // not a numeric community id owned by an entity
    comments: [], // { id, placeId, anonId, label, body, createdAt, hiddenAt }

    // commercial / public-entity accounts — the only accounts that can
    // pay to reach a place with advertising
    entities: [], // { id, businessName, category, email, salt, hash, createdAt }
    sessions: {}, // token -> { entityId, createdAt }

    // ads target a level of the place hierarchy (micro/corregimiento/
    // district/province/country), not a hand-picked lat/lng+radius
    ads: [], // { id, title, text, discountText, targetLevel, targetId, targetName, ownerEntityId, ownerName, hue, createdAt, expiresAt, hiddenAt }

    // reports against a comment or an ad; distinct reporters count toward
    // auto-hiding (see moderation.js)
    reports: [], // { id, targetType: 'comment'|'ad', targetId, anonId, reason, createdAt }
  };
}

function load() {
  try {
    const raw = fs.readFileSync(dataPath, "utf8");
    const parsed = JSON.parse(raw);
    // defensive migration: tolerate data.json files written by an older
    // version of this prototype that predates moderation
    if (!Array.isArray(parsed.reports)) parsed.reports = [];
    if (!parsed.nextReportId) parsed.nextReportId = 1;
    return parsed;
  } catch {
    return emptyState();
  }
}

const state = load();
let saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(dataPath, JSON.stringify(state), "utf8");
  }, 50);
}

module.exports = { state, save };
