// Shared category list for entity accounts. Drives the color used for
// every community/ad bubble that entity creates. Mirrored in
// public/business.js (kept in sync by hand — no bundler in this project).
const CATEGORIES = [
  { id: "comida", label: "Comida y bebida", hue: "#c97a3d" },
  { id: "salud", label: "Salud y bienestar", hue: "#3f8c86" },
  { id: "ocio", label: "Ocio y entretenimiento", hue: "#9c5fb0" },
  { id: "retail", label: "Retail y tiendas", hue: "#c9a83a" },
  { id: "servicios", label: "Servicios", hue: "#4f7fc9" },
  { id: "publico", label: "Público / Gobierno / ONG", hue: "#5fa85f" },
  { id: "otro", label: "Otro", hue: "#8c7a63" },
];

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

function hueForCategory(categoryId) {
  return CATEGORIES.find((c) => c.id === categoryId)?.hue || "#8c7a63";
}

module.exports = { CATEGORIES, CATEGORY_IDS, hueForCategory };
