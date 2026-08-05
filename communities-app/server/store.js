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

    // anonymous individuals — never linked to a real identity
    identities: {}, // anonId -> { label, createdAt }
    // communities are not created by anyone — they're derived from
    // location (see places.js) — so comments key on a placeId (string),
    // not a numeric community id owned by an entity
    comments: [], // { id, placeId, anonId, label, body, createdAt }

    // commercial / public-entity accounts — the only accounts that can
    // pay to reach a place with advertising
    entities: [], // { id, businessName, category, email, salt, hash, createdAt }
    sessions: {}, // token -> { entityId, createdAt }

    // ads target a level of the place hierarchy (micro/corregimiento/
    // district/province/country), not a hand-picked lat/lng+radius
    ads: [], // { id, title, text, discountText, targetLevel, targetId, targetName, ownerEntityId, ownerName, hue, createdAt, expiresAt }
  };
}

function load() {
  try {
    const raw = fs.readFileSync(dataPath, "utf8");
    return JSON.parse(raw);
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
