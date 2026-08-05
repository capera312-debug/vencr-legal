// Catálogo de lugares con jerarquía geográfica real (país → provincia →
// distrito → corregimiento → lugar puntual). En producción esto vendría de
// un servicio de geocodificación inversa real (Nominatim propio, o Google
// Places con API key) consultado con el lat/lng del usuario. Ese acceso de
// red está bloqueado por la política de egress de este entorno de
// desarrollo — ver README — así que acá el catálogo está precargado a mano
// con lugares reales de Ciudad de Panamá, para que la demo tenga datos
// genuinos en vez de inventados.
//
// Si el usuario está lejos de todo lo catalogado, no inventamos nombres de
// ciudad/país falsos: caemos a una "zona cercana" sintética (una celda por
// proximidad, sin jerarquía) y lo decimos explícitamente en la respuesta.

const COUNTRY = { id: "pa", level: "country", name: "Panamá" };
const PROVINCE = { id: "pa-panama", level: "province", name: "Panamá", parentId: "pa" };
const DISTRICT = { id: "pa-panama-panama", level: "district", name: "Distrito de Panamá", parentId: "pa-panama" };

const CORREGIMIENTOS = [
  { id: "san-francisco", level: "corregimiento", name: "San Francisco", parentId: "pa-panama-panama" },
  { id: "bella-vista", level: "corregimiento", name: "Bella Vista", parentId: "pa-panama-panama" },
];

// Coordenadas aproximadas (no catastrales) — alcanza para una demo, no para
// producción real.
const PLACES = [
  { id: "parque-omar", name: "Parque Omar", kind: "parque", corregimientoId: "san-francisco", lat: 8.9925, lng: -79.509 },
  { id: "ph-torres-de-alba", name: "PH Torres de Alba", kind: "ph", corregimientoId: "san-francisco", lat: 8.991, lng: -79.507 },
  { id: "ph-green-park", name: "PH Green Park", kind: "ph", corregimientoId: "san-francisco", lat: 8.993, lng: -79.5075 },
  { id: "calle-uruguay", name: "Calle Uruguay", kind: "establecimiento", corregimientoId: "bella-vista", lat: 8.987, lng: -79.523 },
  { id: "parque-urraca", name: "Parque Urracá", kind: "parque", corregimientoId: "bella-vista", lat: 8.9855, lng: -79.5205 },
  { id: "ph-bella-vista-plaza", name: "PH Bella Vista Plaza", kind: "ph", corregimientoId: "bella-vista", lat: 8.9865, lng: -79.522 },
];

const MICRO_RADIUS_KM = 0.3; // qué tan cerca hay que estar para "estar" en un lugar catalogado
const NEARBY_RADIUS_KM = 1.2; // qué tan lejos se muestran otros lugares catalogados como "cerca"

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// geohash minimalista, solo para nombrar la celda sintética de forma estable
// (misma ubicación aproximada -> mismo id), no para nada más.
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
function tinyGeohash(lat, lng, precision) {
  let latR = [-90, 90], lngR = [-180, 180], even = true, bit = 0, ch = 0, hash = "";
  while (hash.length < precision) {
    const range = even ? lngR : latR;
    const val = even ? lng : lat;
    const mid = (range[0] + range[1]) / 2;
    if (val >= mid) { ch |= 1 << (4 - bit); range[0] = mid; } else { range[1] = mid; }
    even = !even;
    if (bit < 4) bit++; else { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

function corregimientoById(id) {
  return CORREGIMIENTOS.find((c) => c.id === id) || null;
}

// Devuelve dónde está el usuario: un lugar catalogado + su cadena completa
// país/provincia/distrito/corregimiento, o (si no hay nada catalogado cerca)
// una celda sintética sin jerarquía conocida.
function resolveLocation(lat, lng) {
  let closest = null;
  let closestDist = Infinity;
  for (const p of PLACES) {
    const d = haversineKm(lat, lng, p.lat, p.lng);
    if (d < closestDist) { closest = p; closestDist = d; }
  }

  if (closest && closestDist <= MICRO_RADIUS_KM) {
    const corregimiento = corregimientoById(closest.corregimientoId);
    return {
      known: true,
      micro: { id: closest.id, name: closest.name, kind: closest.kind, lat: closest.lat, lng: closest.lng },
      corregimiento,
      district: DISTRICT,
      province: PROVINCE,
      country: COUNTRY,
    };
  }

  const cellId = `cell-${tinyGeohash(lat, lng, 7)}`;
  return {
    known: false,
    micro: { id: cellId, name: "Zona cercana", kind: "zona", lat, lng },
    corregimiento: null,
    district: null,
    province: null,
    country: null,
  };
}

// Otros lugares catalogados cerca del usuario (para el efecto de "burbujas
// vecinas"), excluyendo el que ya es el actual.
function nearbyPlaces(lat, lng, excludeId) {
  return PLACES.filter((p) => p.id !== excludeId)
    .map((p) => ({ ...p, distanceKm: haversineKm(lat, lng, p.lat, p.lng) }))
    .filter((p) => p.distanceKm <= NEARBY_RADIUS_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

// Nodos de jerarquía válidos para targeting de publicidad (usados por el
// portal de comercios: "anunciá acá / en este corregimiento / en esta
// ciudad / en este país").
function targetOptionsFor(location) {
  const options = [{ level: "micro", id: location.micro.id, name: location.micro.name }];
  if (location.corregimiento) options.push({ level: "corregimiento", id: location.corregimiento.id, name: location.corregimiento.name });
  if (location.district) options.push({ level: "district", id: location.district.id, name: location.district.name });
  if (location.province) options.push({ level: "province", id: location.province.id, name: location.province.name });
  if (location.country) options.push({ level: "country", id: location.country.id, name: location.country.name });
  return options;
}

// ¿Un anuncio con este target alcanza a alguien parado en `location`?
function adMatchesLocation(ad, location) {
  if (ad.targetLevel === "micro") return ad.targetId === location.micro.id;
  if (ad.targetLevel === "corregimiento") return !!location.corregimiento && ad.targetId === location.corregimiento.id;
  if (ad.targetLevel === "district") return !!location.district && ad.targetId === location.district.id;
  if (ad.targetLevel === "province") return !!location.province && ad.targetId === location.province.id;
  if (ad.targetLevel === "country") return !!location.country && ad.targetId === location.country.id;
  return false;
}

module.exports = {
  COUNTRY, PROVINCE, DISTRICT, CORREGIMIENTOS, PLACES,
  resolveLocation, nearbyPlaces, targetOptionsFor, adMatchesLocation, haversineKm,
};
