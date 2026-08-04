// Zero-dependency JSON-file store. Good enough for a single-instance
// prototype; swap for a real database before scaling past one process.
const fs = require("fs");
const path = require("path");

const dataPath = process.env.DATA_PATH || path.join(__dirname, "..", "data.json");

function emptyState() {
  return {
    nextCommunityId: 1,
    nextCommentId: 1,
    communities: [], // { id, geohash, lat, lng, createdAt }
    identities: {}, // anonId -> { label, createdAt }
    comments: [], // { id, communityId, anonId, label, body, createdAt }
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
