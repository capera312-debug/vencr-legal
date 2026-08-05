// Minimal auth for entity (business / public org) accounts. Zero
// dependencies: password hashing via Node's built-in scrypt, session
// tokens are opaque random strings kept server-side.
const crypto = require("crypto");

// Free/generic mail providers — rejected so only accounts that look like
// they belong to an organization can register as an entity. This is a
// heuristic, not real KYC/business verification — see README.
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "hotmail.com", "hotmail.es", "hotmail.com.ar", "hotmail.com.mx",
  "outlook.com", "outlook.es",
  "live.com", "live.com.ar",
  "yahoo.com", "yahoo.es", "yahoo.com.ar", "yahoo.com.mx",
  "icloud.com", "me.com", "mac.com",
  "aol.com",
  "protonmail.com", "proton.me",
  "gmx.com", "gmx.es",
  "mail.com",
  "yandex.com",
  "zoho.com",
  "msn.com",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === "string" && EMAIL_RE.test(email);
}

function emailDomain(email) {
  return email.split("@")[1].toLowerCase();
}

function isInstitutionalEmail(email) {
  if (!isValidEmail(email)) return false;
  return !GENERIC_EMAIL_DOMAINS.has(emailDomain(email));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const attempt = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");
  if (attempt.length !== stored.length) return false;
  return crypto.timingSafeEqual(attempt, stored);
}

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

module.exports = {
  isValidEmail,
  emailDomain,
  isInstitutionalEmail,
  hashPassword,
  verifyPassword,
  newToken,
  GENERIC_EMAIL_DOMAINS,
};
