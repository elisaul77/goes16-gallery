/**
 * gifs.js
 * Animaciones tab: hero GIF viewer + 3-category quick-preview grid.
 *
 * Layout:
 *   [controls: region select + category segmented control]
 *   [hero: large animated GIF with skeleton + error state]
 *   [note: daytime-only notice for C02]
 *   [caption: label + technical description]
 *   [cat-grid: 3 smaller GIF cards — clicking one switches the hero]
 */

import { gifUrl, getGifRegions, getCategories } from './manifest.js';
import { buildRegionSelect, buildCategorySegmented, setActiveSegmented } from './selector.js';
import { openLightbox } from './lightbox.js';

// ── Module state ──────────────────────────────────────────────────────────────

let _manifest  = null;
let _regionId  = 'COLOMBIA';
let _catKey    = 'VISUAL';

// DOM references
let _heroImg    = null;
let _heroSkel   = null;
let _heroError  = null;
let _heroNote   = null;
let _heroCaption = null;
let _segEl      = null;
let _catGridEl  = null;

// ── Public ────────────────────────────────────────────────────────────────────

/**
 * Build and mount the Animaciones tab content.
 *
 * @param {HTMLElement} container
 * @param {Object}      manifest
 * @param {{ region?: string, category?: string }} initialState
 */
export function initGifs(container, manifest, initialState = {}) {
  _manifest = manifest;
  _regionId = initialState.region   ?? 'COLOMBIA';
  _catKey   = initialState.category ?? 'VISUAL';

  container.innerHTML = '';

  const regions    = getGifRegions(manifest);
  const categories = getCategories(manifest);

  // ── Controls ───────────────────────────────────────────────
  const controls = document.createElement('div');
  controls.className = 'hero-controls';

  // Region selector — <label for="..."> properly associated with <select id="...">
  const regionWrap = document.createElement('div');
  regionWrap.className = 'control-group';
  const regionLabel = _label('Región', 'gifs-region-sel');
  const regionSel   = buildRegionSelect(regions, _regionId, id => {
    _regionId = id;
    _refreshCatGrid();
    _load();
  });
  regionSel.id = 'gifs-region-sel';
  regionWrap.append(regionLabel, regionSel);

  // Category segmented control — uses <span> (not <label>) because it labels a
  // button group; the group itself carries aria-label="Tipo de imagen".
  const catWrap = document.createElement('div');
  catWrap.className = 'control-group';
  const catLabel = _labelSpan('Canal');
  _segEl = buildCategorySegmented(categories, _catKey, key => {
    _catKey = key;
    _syncCatCards();
    _load();
  });
  catWrap.append(catLabel, _segEl);

  controls.append(regionWrap, catWrap);

  // ── Hero image ─────────────────────────────────────────────
  const heroWrap = document.createElement('div');
  heroWrap.className = 'hero-wrap';
  heroWrap.setAttribute('aria-live', 'polite');
  heroWrap.setAttribute('aria-busy', 'true');

  _heroSkel = document.createElement('div');
  _heroSkel.className = 'skeleton hero-skeleton';
  _heroSkel.setAttribute('aria-hidden', 'true');

  _heroImg = document.createElement('img');
  _heroImg.className = 'hero-img';
  _heroImg.setAttribute('decoding', 'async');
  _heroImg.setAttribute('fetchpriority', 'high');
  _heroImg.addEventListener('click', _openHeroLightbox);

  _heroError = document.createElement('div');
  _heroError.className = 'hero-error hidden';
  _heroError.setAttribute('role', 'alert');
  _heroError.innerHTML = `
    <span class="error-icon" aria-hidden="true">⚠</span>
    <span class="error-text">Imagen no disponible en este momento</span>
    <button class="btn-retry" type="button">Reintentar</button>
  `;
  _heroError.querySelector('.btn-retry').addEventListener('click', _load);

  heroWrap.append(_heroSkel, _heroImg, _heroError);

  // ── Daytime note & caption ─────────────────────────────────
  _heroNote    = document.createElement('p');
  _heroNote.className = 'hero-note';

  _heroCaption = document.createElement('div');
  _heroCaption.className = 'hero-caption';

  // ── Category cards grid ────────────────────────────────────
  _catGridEl = document.createElement('div');
  _catGridEl.className = 'cat-grid';
  _catGridEl.setAttribute('aria-label', 'Canales disponibles para esta región');

  container.append(controls, heroWrap, _heroNote, _heroCaption, _catGridEl);

  _buildCatGrid();
  _load();
}

// ── Private ───────────────────────────────────────────────────────────────────

/** Load and display the current hero GIF. */
function _load() {
  const categories = getCategories(_manifest);
  const regions    = getGifRegions(_manifest);
  const cat        = categories[_catKey];
  const regionLabel = regions.find(r => r.id === _regionId)?.label ?? _regionId;
  const url        = gifUrl(_manifest, _regionId, _catKey);

  // Update ARIA busy state
  _heroImg.closest('.hero-wrap')?.setAttribute('aria-busy', 'true');

  // Show skeleton, hide content & error
  _heroSkel.classList.remove('hidden');
  _heroImg.classList.add('hidden');
  _heroError.classList.add('hidden');

  // Daytime note for C02 (Visual channel)
  const isVisual = cat.canal === 'C02';
  _heroNote.textContent = isVisual
    ? 'El canal visual (C02) solo muestra imagen durante el día.'
    : '';
  _heroNote.classList.toggle('hidden', !isVisual);

  // Caption
  _heroCaption.textContent = `${regionLabel} · ${cat.label} · ${cat.description}`;

  // Alt text
  _heroImg.alt = `Animación GOES-16 — ${cat.label} — ${regionLabel}`;

  // Trigger load
  _heroImg.onload = () => {
    _heroSkel.classList.add('hidden');
    _heroImg.classList.remove('hidden');
    _heroImg.closest('.hero-wrap')?.setAttribute('aria-busy', 'false');
  };
  _heroImg.onerror = () => {
    _heroSkel.classList.add('hidden');
    _heroError.classList.remove('hidden');
    _heroImg.closest('.hero-wrap')?.setAttribute('aria-busy', 'false');
  };
  _heroImg.src = url;
}

/** Open hero in fullscreen lightbox. */
function _openHeroLightbox() {
  const categories  = getCategories(_manifest);
  const regions     = getGifRegions(_manifest);
  const cat         = categories[_catKey];
  const regionLabel = regions.find(r => r.id === _regionId)?.label ?? _regionId;
  openLightbox([{
    url:     _heroImg.src,
    alt:     `GOES-16 ${cat.label} — ${regionLabel}`,
    caption: `${regionLabel} · ${cat.label} · ${cat.description}`,
  }], 0);
}

/** Build the 3-card category grid for the current region. */
function _buildCatGrid() {
  _catGridEl.innerHTML = '';
  const categories = getCategories(_manifest);

  for (const [key, cat] of Object.entries(categories)) {
    const card = _buildCatCard(key, cat);
    _catGridEl.appendChild(card);
  }
}

/** Rebuild GIF src in each category card when region changes. */
function _refreshCatGrid() {
  _catGridEl.querySelectorAll('.cat-card').forEach(card => {
    const key     = card.dataset.cat;
    const img     = card.querySelector('.cat-card-img');
    const skel    = card.querySelector('.cat-card-skeleton');
    const imgWrap = card.querySelector('.cat-card-img-wrap');
    if (!img || !key) return;

    // Reset to loading state (clear any previous error state)
    img.classList.add('hidden');
    imgWrap?.classList.remove('img-error');
    skel?.classList.remove('hidden');

    const url = gifUrl(_manifest, _regionId, key);
    img.onload  = () => { skel?.classList.add('hidden'); img.classList.remove('hidden'); };
    img.onerror = () => { skel?.classList.add('hidden'); imgWrap?.classList.add('img-error'); };
    img.src = url;
  });
}

/** Sync the active highlight on category cards to match _catKey. */
function _syncCatCards() {
  _catGridEl.querySelectorAll('.cat-card').forEach(card => {
    card.classList.toggle('active', card.dataset.cat === _catKey);
    card.setAttribute('aria-current', card.dataset.cat === _catKey ? 'true' : 'false');
  });
}

/** Build a single category card element. */
function _buildCatCard(key, cat) {
  const card = document.createElement('div');
  card.className = 'cat-card' + (key === _catKey ? ' active' : '');
  card.dataset.cat = key;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${cat.label} — ${cat.description}`);
  card.setAttribute('aria-current', key === _catKey ? 'true' : 'false');

  // Image area
  const imgWrap = document.createElement('div');
  imgWrap.className = 'cat-card-img-wrap';

  const skel = document.createElement('div');
  skel.className = 'skeleton cat-card-skeleton';
  skel.setAttribute('aria-hidden', 'true');

  const img = document.createElement('img');
  img.className = 'cat-card-img hidden';
  img.loading  = 'lazy';
  img.decoding = 'async';
  img.alt = `GIF ${cat.label} — ${_regionId}`;
  img.width  = 400;
  img.height = 300;

  const url = gifUrl(_manifest, _regionId, key);
  img.onload  = () => { skel.classList.add('hidden'); img.classList.remove('hidden'); };
  img.onerror = () => { skel.classList.add('hidden'); imgWrap.classList.add('img-error'); };
  img.src = url;

  imgWrap.append(skel, img);

  // Card body
  const body = document.createElement('div');
  body.className = 'cat-card-body';

  const titleRow = document.createElement('div');
  titleRow.className = 'cat-card-title';
  const titleText = document.createTextNode(cat.label);
  const badge = document.createElement('span');
  badge.className = 'cat-badge';
  badge.textContent = cat.canal;
  badge.setAttribute('aria-label', `Canal ${cat.canal}`);
  titleRow.append(titleText, badge);

  const desc = document.createElement('p');
  desc.className = 'cat-card-desc';
  desc.textContent = cat.description;

  body.append(titleRow, desc);
  card.append(imgWrap, body);

  // Click / Enter → switch category
  const _activate = () => {
    _catKey = key;
    setActiveSegmented(_segEl, key);
    _syncCatCards();
    _load();
  };
  card.addEventListener('click', _activate);
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _activate(); }
  });

  return card;
}

/**
 * Create a <label> element associated with a form control.
 * @param {string} text   - visible label text
 * @param {string} [forId] - value for the `for` attribute (the control's id)
 */
function _label(text, forId) {
  const el = document.createElement('label');
  el.className = 'control-label';
  el.textContent = text;
  if (forId) el.htmlFor = forId;
  return el;
}

/**
 * Create a <span> label for non-form controls (button groups, segmented controls).
 * @param {string} text
 */
function _labelSpan(text) {
  const el = document.createElement('span');
  el.className = 'control-label';
  el.textContent = text;
  return el;
}
