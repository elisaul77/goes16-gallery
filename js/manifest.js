/**
 * manifest.js
 * Loads data/manifest.json (falls back to data/manifest.sample.json).
 * Provides typed accessors and shared data utilities.
 */

const PRIMARY  = 'data/manifest.json';
const FALLBACK = 'data/manifest.sample.json';

/** @type {Object|null} */
let _cache = null;

// ── Loading ─────────────────────────────────────────────────────────────────

/**
 * Load and cache the manifest.  Tries PRIMARY first, then FALLBACK.
 * @returns {Promise<Object>}
 */
export async function loadManifest() {
  for (const url of [PRIMARY, FALLBACK]) {
    try {
      // credentials:'omit' aligns with <link rel="preload" as="fetch" crossorigin>
      // (crossorigin=anonymous → credentials omit), so the browser reuses the
      // preloaded response from cache instead of making a second round-trip.
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) continue;
      _cache = await res.json();
      _cache._sourceUrl = url;
      return _cache;
    } catch {
      // try next source
    }
  }
  throw new Error(
    'No se pudo cargar el manifiesto de imágenes. Verifica tu conexión.'
  );
}

/** Return the previously loaded manifest (loadManifest must have been called). */
export function getManifest() {
  return _cache;
}

// ── GIF accessors ────────────────────────────────────────────────────────────

/**
 * Build the absolute GIF URL for a region + category key.
 * Appends a cache-busting epoch derived from manifest.generated_utc.
 *
 * @param {Object} manifest
 * @param {string} regionId   - e.g. "COLOMBIA"
 * @param {string} catKey     - "VISUAL" | "INFRARROJO" | "VAPOR_AGUA"
 * @returns {string}
 */
export function gifUrl(manifest, regionId, catKey) {
  const cat   = manifest.gifs.categories[catKey];
  const epoch = new Date(manifest.generated_utc).getTime();
  return `${manifest.gifs.base_url}/${cat.subfolder}/${regionId}_${cat.canal}.gif?t=${epoch}`;
}

/**
 * Return the GIF regions array from the manifest.
 * @param {Object} manifest
 * @returns {Array<{id:string, label:string, hero?:boolean}>}
 */
export function getGifRegions(manifest) {
  return manifest.gifs.regions;
}

/**
 * Return the GIF categories object from the manifest.
 * @param {Object} manifest
 * @returns {Object}
 */
export function getCategories(manifest) {
  return manifest.gifs.categories;
}

// ── JPG accessors ────────────────────────────────────────────────────────────

/**
 * Return all products for a region ('Colombia' | 'Global').
 * @param {Object} manifest
 * @param {string} regionKey
 * @returns {Object} keyed by product id
 */
export function getProducts(manifest, regionKey) {
  return manifest.regions[regionKey]?.products ?? {};
}

/**
 * Return the frames array for a specific region + product.
 * Frames are already sorted descending by timestamp in the manifest.
 *
 * @param {Object} manifest
 * @param {string} regionKey  - 'Colombia' | 'Global'
 * @param {string} productId  - e.g. 'C13', 'TRUE_COLOR'
 * @returns {Array<{ts:string, url:string}>}
 */
export function getFrames(manifest, regionKey, productId) {
  return manifest.regions[regionKey]?.products?.[productId]?.frames ?? [];
}

// ── Timestamp utility ────────────────────────────────────────────────────────

/**
 * Convert a 12-character GOES timestamp (YYYYMMDDHHmm) to readable strings.
 *
 * @param {string} ts  - e.g. "202607072220"
 * @returns {{ utcStr: string, colStr: string, full: string }}
 *
 * utcStr  : "2026-07-07 22:20 UTC"
 * colStr  : "17:20 COL"  (Colombia is UTC−5)
 * full    : "2026-07-07 22:20 UTC · 17:20 COL"
 */
export function formatTimestamp(ts) {
  if (!ts || ts.length < 12) return { utcStr: ts ?? '', colStr: '', full: ts ?? '' };

  const yr = ts.slice(0, 4);
  const mo = ts.slice(4, 6);
  const dy = ts.slice(6, 8);
  const hr = ts.slice(8, 10);
  const mn = ts.slice(10, 12);

  const utcStr = `${yr}-${mo}-${dy} ${hr}:${mn} UTC`;

  // Colombia is UTC−5; (hour + 19) mod 24 avoids negative modulo
  const hNum  = parseInt(hr, 10);
  const colH  = String((hNum + 19) % 24).padStart(2, '0');
  const colStr = `${colH}:${mn} COL`;

  return { utcStr, colStr, full: `${utcStr} · ${colStr}` };
}
