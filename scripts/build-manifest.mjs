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

/**
 * Listing URL for a product subfolder within a region.
 * Real IDEAM structure: Colombia/{PRODUCT_ID}/ (one subfolder per product).
 * Example: /geotiff/goes16/Colombia/C13/ or /geotiff/goes16/Colombia/AIR_MASS/
 */
function productListingUrl(regionFolder, productId) {
  return `${BASE_URL}/${regionFolder}/${productId}/`;
}

/**
 * Image URL for Colombia channel frames.
 * Files live in per-channel subfolder: Colombia/{C##}/{C##}_Rad_{ts}.jpg
 */
function colombiaChannelUrl(channelId, ts) {
  return `${BASE_URL}/Colombia/${channelId}/${channelId}_Rad_${ts}.jpg`;
}

/**
 * Image URL for Colombia composite/product frames.
 * Files live in per-product subfolder: Colombia/{PRODUCT}/{PRODUCT}_{ts}.jpg
 */
function colombiaCompositeUrl(productId, ts) {
  return `${BASE_URL}/Colombia/${productId}/${productId}_${ts}.jpg`;
}

/**
 * Image URL for Global channel frames.
 * Files live in per-channel subfolder: Global/{C##}/{C##}_Rad_{ts}.jpg
 */
function globalChannelUrl(channelId, ts) {
  return `${BASE_URL}/Global/${channelId}/${channelId}_Rad_${ts}.jpg`;
}

// ─── HTML parsing ─────────────────────────────────────────────────────────────

/**
 * Parse an Apache/Nginx-style directory listing HTML and return an array of
 * { filename, ts } objects for .jpg files, sorted descending by timestamp.
 *
 * Robust parsing:
 *  - Handles both single and double-quoted href attributes.
 *  - Strips path prefixes and query strings from filenames.
 *  - Accepts timestamps of 10–14 digits (truncated to 12 for YYYYMMDDHHmm).
 *
 * Filename patterns:
 *   C{NN}_Rad_{TIMESTAMP}.jpg    → channel (C01–C16)
 *   {PRODUCT}_{TIMESTAMP}.jpg    → composite product
 */
function parseListingHtml(html) {
  // Match hrefs pointing to .jpg/.jpeg files.
  // Supports both single-quoted and double-quoted href values.
  const hrefRe = /href=["']([^"']+\.jpe?g)["']/gi;
  const results = [];
  let match;

  while ((match = hrefRe.exec(html)) !== null) {
    // Strip path prefix (e.g. /geotiff/goes16/Colombia/) and query string
    const filename = match[1].split('/').pop().split('?')[0];
    if (!filename) continue;

    // Pattern 1: C13_Rad_202607072220.jpg or C13_Rad_20260708003000.jpg
    // Accepts 10–14 digit timestamps; truncates to first 12 (YYYYMMDDHHmm).
    const channelMatch = filename.match(/^(C\d{2})_Rad_(\d{10,14})\.jpe?g$/i);
    if (channelMatch) {
      const ts = channelMatch[2].slice(0, 12);
      results.push({ filename, productId: channelMatch[1].toUpperCase(), ts });
      continue;
    }

    // Pattern 2: TRUE_COLOR_202607072220.jpg / AIR_MASS_202607072220.jpg
    // productId = everything before the final _TIMESTAMP segment
    const compositeMatch = filename.match(/^(.+?)_(\d{10,14})\.jpe?g$/i);
    if (compositeMatch) {
      const ts = compositeMatch[2].slice(0, 12);
      results.push({ filename, productId: compositeMatch[1].toUpperCase(), ts });
    }
  }

  // Sort descending by timestamp string (YYYYMMDDHHmm — lexicographic = chronological)
  results.sort((a, b) => b.ts.localeCompare(a.ts));

  // Diagnostic: in real mode with zero results, dump a sample of the listing
  // so CI logs reveal the actual server format.
  if (!FIXTURE_MODE && results.length === 0) {
    console.warn('WARN: parseListingHtml found 0 jpg entries. Listing sample (first 500 chars):');
    console.warn(html.slice(0, 500));
  }

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

// ─── Product builder (see fetchProductFrames inside main) ─────────────────────

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

  // ── JPG listings (per-product subfolder) ──────────────────────────────────
  //
  // Real IDEAM structure: each product lives in its own subfolder.
  //   Colombia/C13/C13_Rad_202607072220.jpg
  //   Colombia/AIR_MASS/AIR_MASS_202607072220.jpg
  //   Global/C02/C02_Rad_202607072220.jpg
  //
  // Fixture mode: fetchListing ignores the URL and returns the same flat
  // fixture file for every call — filtering by productId still works.

  let successCount = 0;

  /**
   * Fetch the directory listing for one product's subfolder and extract frames.
   * @param {string}   regionFolder - 'Colombia' | 'Global'
   * @param {Object}   def          - { id, label, type }
   * @param {Function} urlBuilder   - (productId, ts) => absoluteUrl
   */
  async function fetchProductFrames(regionFolder, def, urlBuilder) {
    const listUrl = FIXTURE_MODE
      ? null  // ignored by fetchListing in fixture mode
      : productListingUrl(regionFolder, def.id);
    try {
      const html    = await fetchListing(listUrl);
      const all     = parseListingHtml(html);
      const entries = all.filter(e => e.productId === def.id).slice(0, MAX_FRAMES);
      return {
        label: def.label,
        type:  def.type,
        frames: entries.map(e => ({ ts: e.ts, url: urlBuilder(def.id, e.ts) })),
      };
    } catch (err) {
      console.warn(`${regionFolder}/${def.id} listing failed: ${err.message}`);
      return { label: def.label, type: def.type, frames: [] };
    }
  }

  // Colombia — fetch all product subfolders in parallel
  {
    const colDefs = [
      ...COLOMBIA_CHANNELS.map(d => ({ ...d, urlFn: colombiaChannelUrl })),
      ...COLOMBIA_COMPOSITES.map(d => ({ ...d, urlFn: colombiaCompositeUrl })),
    ];
    const colResults = await Promise.all(
      colDefs.map(d => fetchProductFrames('Colombia', d, d.urlFn))
    );
    colDefs.forEach((d, i) => {
      manifest.regions.Colombia.products[d.id] = colResults[i];
    });
    const colSuccess = colResults.filter(p => p.frames.length > 0).length;
    successCount += colSuccess;
    console.log(`Colombia: ${colDefs.length} products, ${colSuccess} with frames`);
  }

  // Global — same pattern
  {
    const gloResults = await Promise.all(
      GLOBAL_CHANNELS.map(d => fetchProductFrames('Global', d, globalChannelUrl))
    );
    GLOBAL_CHANNELS.forEach((d, i) => {
      manifest.regions.Global.products[d.id] = gloResults[i];
    });
    const gloSuccess = gloResults.filter(p => p.frames.length > 0).length;
    successCount += gloSuccess;
    console.log(`Global: ${GLOBAL_CHANNELS.length} products, ${gloSuccess} with frames`);
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
