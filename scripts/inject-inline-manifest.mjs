/**
 * inject-inline-manifest.mjs
 * Embeds a compact snapshot of data/manifest.json into index.html as a
 * <script type="application/json" id="manifest-inline"> tag.
 *
 * The app reads this tag as a last-resort fallback when both fetch() calls
 * fail (e.g. when the user's network blocks same-origin XHR from cached pages).
 *
 * Inline manifest is kept small: full gifs section + only the 6 most recent
 * frames per JPG product.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath }               from 'url';
import { dirname, join }               from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = join(__dir, '..');

const html = readFileSync(join(root, 'index.html'), 'utf8');
const m    = JSON.parse(readFileSync(join(root, 'data/manifest.json'), 'utf8'));

// Build compact manifest
const mini = {
  generated_utc: m.generated_utc,
  source:        m.source,
  gifs:          m.gifs,
  regions:       {},
};
for (const [rk, rv] of Object.entries(m.regions)) {
  mini.regions[rk] = { products: {} };
  for (const [pk, pv] of Object.entries(rv.products)) {
    mini.regions[rk].products[pk] = { ...pv, frames: pv.frames.slice(0, 6) };
  }
}

const json = JSON.stringify(mini);
const tag  = `<script type="application/json" id="manifest-inline">${json}<\/script>`;

// Replace existing tag if present, otherwise inject before </body>
const existing = /<script type="application\/json" id="manifest-inline">[\s\S]*?<\/script>/;
const updated  = existing.test(html)
  ? html.replace(existing, tag)
  : html.replace('</body>', `  ${tag}\n</body>`);

writeFileSync(join(root, 'index.html'), updated);
console.log(`inline manifest injected — generated_utc: ${mini.generated_utc}`);
