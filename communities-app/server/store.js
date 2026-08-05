// Zero-dependency JSON-file store. Good enough for a single-instance
// prototype; swap for a real database before scaling past one process.
const fs = require("fs");
const path = require("path");

const dataPath = process.env.DATA_PATH || path.join(__dirname, "..", "data.json");

function emptyState() {
  return {
    nextCommunityId: 1,
    nextCommentId: 1,
    nextEntityId: 1,
    nextAdId: 1,

    // anonymous individuals — never linked to a real identity
    identities: {}, // anonId -> { label, createdAt }
    comments: [], // { id, communityId, anonId, label, body, createdAt }

    // commercial / public-entity accounts — the only accounts that can
    // found a community or launch advertising
    entities: [], // { id, businessName, category, email, salt, hash, createdAt }
    sessions: {}, // token -> { entityId, createdAt }

    communities: [], // { id, name, description, ownerEntityId, ownerName, hue, lat, lng, radiusKm, createdAt }
    ads: [], // { id, title, text, discountText, ownerEntityId, ownerName, hue, lat, lng, radiusKm, createdAt, expiresAt }
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
