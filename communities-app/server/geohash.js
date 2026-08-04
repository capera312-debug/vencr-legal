// Minimal geohash encoder. Used to bucket users into location-based
// "community" cells without ever persisting their exact coordinates.
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

function encodeGeohash(lat, lng, precision) {
  let latRange = [-90, 90];
  let lngRange = [-180, 180];
  let isEven = true;
  let bit = 0;
  let ch = 0;
  let hash = "";

  while (hash.length < precision) {
    if (isEven) {
      const mid = (lngRange[0] + lngRange[1]) / 2;
      if (lng >= mid) {
        ch |= 1 << (4 - bit);
        lngRange[0] = mid;
      } else {
        lngRange[1] = mid;
      }
    } else {
      const mid = (latRange[0] + latRange[1]) / 2;
      if (lat >= mid) {
        ch |= 1 << (4 - bit);
        latRange[0] = mid;
      } else {
        latRange[1] = mid;
      }
    }
    isEven = !isEven;
    if (bit < 4) {
      bit++;
    } else {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

function decodeGeohashCenter(hash) {
  let latRange = [-90, 90];
  let lngRange = [-180, 180];
  let isEven = true;

  for (const c of hash) {
    const idx = BASE32.indexOf(c);
    for (let bit = 4; bit >= 0; bit--) {
      const bitVal = (idx >> bit) & 1;
      if (isEven) {
        const mid = (lngRange[0] + lngRange[1]) / 2;
        if (bitVal === 1) lngRange[0] = mid;
        else lngRange[1] = mid;
      } else {
        const mid = (latRange[0] + latRange[1]) / 2;
        if (bitVal === 1) latRange[0] = mid;
        else latRange[1] = mid;
      }
      isEven = !isEven;
    }
  }

  return {
    lat: (latRange[0] + latRange[1]) / 2,
    lng: (lngRange[0] + lngRange[1]) / 2,
  };
}

// Precision 6 ≈ cells of roughly 610m x 1200m — tight enough to feel
// like "this block / this plaza", loose enough to not pinpoint anyone.
const DEFAULT_PRECISION = 6;

module.exports = { encodeGeohash, decodeGeohashCenter, DEFAULT_PRECISION };
