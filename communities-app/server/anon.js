// Generates human-friendly anonymous display labels. Purely cosmetic —
// never used as a stable identifier, never linked to a person.
const ADJECTIVES = [
  "Curioso", "Silencioso", "Errante", "Nocturno", "Veloz", "Sereno",
  "Despierto", "Lejano", "Cercano", "Anónimo", "Discreto", "Nómada",
];
const NOUNS = [
  "Zorro", "Búho", "Colibrí", "Gato", "Lobo", "Cuervo",
  "Delfín", "Tejón", "Puma", "Halcón", "Lince", "Ciervo",
];

function randomAnonLabel() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = Math.floor(Math.random() * 90 + 10);
  return `${a} ${n} #${suffix}`;
}

module.exports = { randomAnonLabel };
