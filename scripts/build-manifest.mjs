#!/usr/bin/env node
/**
 * build-manifest.mjs
 * Scrapes IDEAM GOES-16 directory listings and generates data/manifest.json.
 *
 * Usage:
 *   node scripts/build-manifest.mjs            # real network fetch
 *   node scripts/build-manifest.mjs --fixture  # zero-network, uses local fixture
 *
 * Modes
 * ─────
 * --fixture : reads scripts/__fixtures__/listing.html for ALL product listings
 *             and simulates HEAD responses (ok: true, last_modified: fake ISO string).
 *             No network calls are made whatsoever.
 *
 * real mode : fetch with retry ×3 + exponential backoff.
 *             Respects NODE_TLS_REJECT_UNAUTHORIZED from the environment.
 *             Exit 0 if at least one product has frames; exit 1 only on total failure.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

import { BASE_URL, CATEGORIES, REGIONS, gifUrl } from './gif-registry.mjs';

// ─── Paths ──────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, '..');
const FIXTURE    = join(__dirname, '__fixtures__', 'listing.html');
const OUT_FILE   = join(ROOT, 'data', 'manifest.json');

// ─── CLI flags ───────────────────────────────────────────────────────────────

const FIXTURE_MODE = process.argv.includes('--fixture');
const MAX_FRAMES   = 48;
const FAKE_LAST_MOD = 'Mon, 07 Jul 2026 22:20:00 GMT';

// ─── Product definitions ─────────────────────────────────────────────────────

/**
 * Colombia JPG products.
 * Channels C01–C16 use pattern: C{NN}_Rad_{TIMESTAMP}.jpg
 * Composite products use pattern: {PRODUCT}_{TIMESTAMP}.jpg
 */
const COLOMBIA_CHANNELS = [
  { id: 'C01', label: 'Visible azul',              type: 'channel' },
  { id: 'C02', label: 'Visible rojo',              type: 'channel' },
  { id: 'C03', label: 'Veggie (0.86 µm)',          type: 'channel' },
  { id: 'C04', label: 'Cirrus (1.37 µm)',          type: 'channel' },
  { id: 'C05', label: 'Nieve/hielo (1.6 µm)',      type: 'channel' },
  { id: 'C06', label: 'Nube convectica (2.2 µm)',  type: 'channel' },
  { id: 'C07', label: 'IR shortwave (3.9 µm)',     type: 'channel' },
  { id: 'C08', label: 'Vapor de agua superior',    type: 'channel' },
  { id: 'C09', label: 'Vapor de agua medio',       type: 'channel' },
  { id: 'C10', label: 'Vapor de agua inferior',    type: 'channel' },
  { id: 'C11', label: 'IR nube/superficie',        type: 'channel' },
  { id: 'C12', label: 'IR ozono (9.6 µm)',         type: 'channel' },
  { id: 'C13', label: 'IR ventana limpia',         type: 'channel' },
  { id: 'C14', label: 'IR ventana (11.2 µm)',      type: 'channel' },
  { id: 'C15', label: 'IR CO₂ (12.3 µm)',          type: 'channel' },
  { id: 'C16', label: 'IR CO₂ (13.3 µm)',          type: 'channel' },
];

const COLOMBIA_COMPOSITES = [
  { id: 'AIR_MASS',   label: 'Masa de aire',          type: 'product' },
  { id: 'ASH',        label: 'Ceniza volcánica',       type: 'product' },
  { id: 'DAY_CLOUD',  label: 'Nube diurna fase',       type: 'product' },
  { id: 'DAY_CONV',   label: 'Convección diurna',      type: 'product' },
  { id: 'DUST',       label: 'Polvo y aerosoles',      type: 'product' },
  { id: 'FIRE_TEMP',  label: 'Temperatura de fuego',   type: 'product' },
  { id: 'SNOW_FOG',   label: 'Nieve y niebla',         type: 'product' },
  { id: 'TRUE_COLOR', label: 'Color verdadero',        type: 'product' },
  { id: 'WATER_VAPOR',label: 'Vapor de agua RGB',      type: 'product' },
];

const GLOBAL_CHANNELS = [
  { id: 'C02', label: 'Visible rojo (global)',  type: 'channel' },
  { id: 'C08', label: 'Vapor de agua (global)', type: 'channel' },
  { id: 'C13', label: 'IR ventana (global)',    type: 'channel' },
];

// ─── URL helpers ─────────────────────────────────────────────────────────────

/** Listing URL for a given region folder */
function listingUrl(regionFolder) {
  return `${BASE_URL}/${regionFolder}/`;
}

/** Image URL for Colombia channel frames */
function colombiaChannelUrl(channelId, ts) {
  return `${BASE_URL}/Colombia/${channelId}_Rad_${ts}.jpg`;
}

/** Image URL for Colombia composite frames */
function colombiaCompositeUrl(productId, ts) {
  return `${BASE_URL}/Colombia/${productId}_${ts}.jpg`;
}

/** Image URL for Global channel frames */
function globalChannelUrl(channelId, ts) {
  return `${BASE_URL}/Global/${channelId}_Rad_${ts}.jpg`;
}

// ─── HTML parsing ─────────────────────────────────────────────────────────────

/**
 * Parse an Apache-style directory listing HTML and return an array of
 * { filename, ts } objects for .jpg files, sorted descending by timestamp.
 *
 * Handles two filename patterns:
 *   C{NN}_Rad_{TIMESTAMP}.jpg   → channel
 *   {PRODUCT}_{TIMESTAMP}.jpg   → composite (TIMESTAMP = last numeric segment)
 */
function parseListingHtml(html) {
  // Match hrefs pointing to .jpg files
  const hrefRe = /href="([^"]+\.jpg)"/gi;
  const results = [];
  let match;

  while ((match = hrefRe.exec(html)) !== null) {
    const filename = match[1].split('/').pop(); // strip any path prefix

    // Pattern 1: C13_Rad_202607072220.jpg  (case-insensitive; productId normalised to
    // uppercase so it matches def.id — the original filename is preserved for reference
    // only, URLs are always built via urlBuilder(def.id, ts) not from filename).
    const channelMatch = filename.match(/^(C\d{2})_Rad_(\d{12})\.jpg$/i);
    if (channelMatch) {
      results.push({ filename, productId: channelMatch[1].toUpperCase(), ts: channelMatch[2] });
      continue;
    }

    // Pattern 2: TRUE_COLOR_202607072220.jpg / AIR_MASS_202607072220.jpg
    const compositeMatch = filename.match(/^(.+?)_(\d{12})\.jpg$/i);
    if (compositeMatch) {
      results.push({ filename, productId: compositeMatch[1].toUpperCase(), ts: compositeMatch[2] });
    }
  }

  // Sort descending by timestamp string (YYYYMMDDHHmm — lexicographic = chronological)
  results.sort((a, b) => b.ts.localeCompare(a.ts));
  return results;
}

// ─── Network helpers ──────────────────────────────────────────────────────────

/** Sleep helper */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Fetch with exponential backoff retry.
 *  res.ok is checked inside the loop so transient HTTP 5xx errors are retried. */
async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await sleep(500 * Math.pow(2, attempt));
    }
  }
}

// ─── Listing fetcher ──────────────────────────────────────────────────────────

/**
 * Fetch a directory listing.
 * In fixture mode: always return the local fixture file content.
 * In real mode: HTTP GET with retry.
 */
async function fetchListing(url) {
  if (FIXTURE_MODE) {
    return readFileSync(FIXTURE, 'utf8');
  }
  // res.ok is already validated inside fetchWithRetry — no redundant check needed.
  const res = await fetchWithRetry(url, { signal: AbortSignal.timeout(15_000) });
  return res.text();
}

// ─── GIF verifier ────────────────────────────────────────────────────────────

/**
 * Verify a GIF URL via HEAD request.
 * Returns { ok: boolean, last_modified: string|null }
 */
async function verifyGif(url) {
  if (FIXTURE_MODE) {
    return { ok: true, last_modified: FAKE_LAST_MOD };
  }
  try {
    const res = await fetchWithRetry(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    });
    return {
      ok: res.ok,
      last_modified: res.headers.get('last-modified') || null,
    };
  } catch {
    return { ok: false, last_modified: null };
  }
}

// ─── Product builder ──────────────────────────────────────────────────────────

/**
 * Build frames array for a set of products from a single listing HTML.
 * @param {string} html           - directory listing HTML
 * @param {Array}  productDefs    - array of { id, label, type }
 * @param {Function} urlBuilder   - (productId, ts) => absoluteUrl
 * @returns {Object}              - { [productId]: { label, type, frames } }
 */
function buildProductFrames(html, productDefs, urlBuilder) {
  const allEntries = parseListingHtml(html);

  const products = {};
  for (const def of productDefs) {
    // For channels the productId in the listing matches def.id (e.g. 'C13')
    // For composites it matches def.id too (e.g. 'TRUE_COLOR')
    const entries = allEntries
      .filter(e => e.productId === def.id)
      .slice(0, MAX_FRAMES);

    products[def.id] = {
      label: def.label,
      type:  def.type,
      frames: entries.map(e => ({
        ts:  e.ts,
        url: urlBuilder(def.id, e.ts),
      })),
    };
  }
  return products;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`build-manifest: mode=${FIXTURE_MODE ? 'fixture' : 'real'}`);

  const manifest = {
    generated_utc: new Date().toISOString(),
    source: BASE_URL,
    gifs: {
      base_url: `${BASE_URL}/GIFS`,
      categories: Object.fromEntries(
        Object.entries(CATEGORIES).map(([key, cat]) => [
          key,
          {
            label:       cat.label,
            subfolder:   cat.subfolder,
            canal:       cat.canal,
            description: cat.description,
          },
        ])
      ),
      regions: REGIONS.map(r => ({
        id:    r.id,
        label: r.label,
        ...(r.hero ? { hero: true } : {}),
      })),
      verified: {},
    },
    regions: {
      Colombia: { products: {} },
      Global:   { products: {} },
    },
  };

  // ── JPG listings ───────────────────────────────────────────────────────────

  let successCount = 0;

  // Colombia listing
  try {
    const colombiaHtml = await fetchListing(listingUrl('Colombia'));
    const channelProds  = buildProductFrames(
      colombiaHtml,
      COLOMBIA_CHANNELS,
      colombiaChannelUrl
    );
    const compositeProds = buildProductFrames(
      colombiaHtml,
      COLOMBIA_COMPOSITES,
      colombiaCompositeUrl
    );
    manifest.regions.Colombia.products = { ...channelProds, ...compositeProds };
    successCount += Object.values(manifest.regions.Colombia.products)
      .filter(p => p.frames.length > 0).length;
    console.log(`Colombia: ${Object.keys(manifest.regions.Colombia.products).length} products parsed`);
  } catch (err) {
    console.error(`Colombia listing failed: ${err.message}`);
    // Mark all Colombia products with empty frames
    for (const def of [...COLOMBIA_CHANNELS, ...COLOMBIA_COMPOSITES]) {
      manifest.regions.Colombia.products[def.id] = {
        label: def.label, type: def.type, frames: [],
      };
    }
  }

  // Global listing
  try {
    const globalHtml = await fetchListing(listingUrl('Global'));
    manifest.regions.Global.products = buildProductFrames(
      globalHtml,
      GLOBAL_CHANNELS,
      globalChannelUrl
    );
    successCount += Object.values(manifest.regions.Global.products)
      .filter(p => p.frames.length > 0).length;
    console.log(`Global: ${Object.keys(manifest.regions.Global.products).length} products parsed`);
  } catch (err) {
    console.error(`Global listing failed: ${err.message}`);
    for (const def of GLOBAL_CHANNELS) {
      manifest.regions.Global.products[def.id] = {
        label: def.label, type: def.type, frames: [],
      };
    }
  }

  // ── GIF verification ───────────────────────────────────────────────────────

  console.log(`Verifying ${REGIONS.length} regions × ${Object.keys(CATEGORIES).length} categories GIFs…`);
  const gifTasks = [];
  for (const region of REGIONS) {
    for (const catKey of Object.keys(CATEGORIES)) {
      const url = gifUrl(region.id, catKey);
      const key = `${region.id}_${CATEGORIES[catKey].canal}`;
      gifTasks.push(
        verifyGif(url).then(result => {
          manifest.gifs.verified[key] = result;
        })
      );
    }
  }
  await Promise.all(gifTasks);

  const gifOkCount = Object.values(manifest.gifs.verified).filter(v => v.ok).length;
  console.log(`GIFs verified: ${gifOkCount}/${gifTasks.length} OK`);

  // ── Write output ───────────────────────────────────────────────────────────

  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Manifest written → ${OUT_FILE}`);

  // Validate JSON round-trip
  const parsed = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
  console.log(`Validation: JSON.parse OK — generated_utc: ${parsed.generated_utc}`);

  if (successCount === 0) {
    console.error('ERROR: zero products with frames — exiting 1');
    process.exit(1);
  }

  console.log(`Done. ${successCount} products with frames.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
