/**
 * gallery.js
 * Galería tab: responsive grid of JPG frames with lazy loading,
 * skeleton loaders, region + product selectors, and lightbox integration.
 *
 * Lazy loading strategy:
 *  - Images start with data-src (not src) to avoid network requests.
 *  - An IntersectionObserver with rootMargin=400px promotes data-src → src
 *    before the card enters the viewport.
 *  - Skeleton disappears on image load; error state shown on failure.
 */

import { getProducts, getFrames, formatTimestamp } from './manifest.js';
import { buildRegionSelect, buildProductSelect } from './selector.js';
import { openLightbox } from './lightbox.js';

// Two "region keys" for JPG regions (different from the 23 GIF regions)
const JPG_REGIONS = [
  { id: 'Colombia', label: 'Colombia' },
  { id: 'Global',   label: 'Global'   },
];

// ── Module state ──────────────────────────────────────────────────────────────

let _manifest   = null;
let _regionKey  = 'Colombia';
let _productId  = null;

/** @type {IntersectionObserver|null} */
let _observer   = null;

// DOM references
let _gridEl           = null;
let _prodContainerEl  = null;

// ── Public ────────────────────────────────────────────────────────────────────

/**
 * Build and mount the Galería tab content.
 * @param {HTMLElement} container
 * @param {Object}      manifest
 */
export function initGallery(container, manifest) {
  _manifest  = manifest;
  _regionKey = 'Colombia';

  container.innerHTML = '';

  // ── Top controls ───────────────────────────────────────────
  const topRow = document.createElement('div');
  topRow.className = 'gallery-top';

  // Region selector
  const regionWrap = document.createElement('div');
  regionWrap.className = 'control-group';
  regionWrap.append(_label('Región'));
  regionWrap.appendChild(buildRegionSelect(JPG_REGIONS, _regionKey, rk => {
    _regionKey = rk;
    _rebuildProductSelector();
    _renderGrid();
  }));

  // Product selector (mutable container, rebuilt on region change)
  _prodContainerEl = document.createElement('div');
  _prodContainerEl.className = 'control-group';
  _buildProductSelector();

  topRow.append(regionWrap, _prodContainerEl);

  // ── Grid ───────────────────────────────────────────────────
  _gridEl = document.createElement('div');
  _gridEl.className = 'gallery-grid';
  _gridEl.setAttribute('role', 'list');
  _gridEl.setAttribute('aria-label', 'Fotogramas de imágenes satelitales');

  container.append(topRow, _gridEl);
  _renderGrid();
}

// ── Private: product selector ─────────────────────────────────────────────────

function _buildProductSelector() {
  const products = getProducts(_manifest, _regionKey);
  // Keep current product if it still exists in new region; otherwise take first
  if (!products[_productId]) {
    _productId = Object.keys(products)[0] ?? null;
  }

  _prodContainerEl.innerHTML = '';
  _prodContainerEl.appendChild(_label('Producto / Canal'));

  const sel = buildProductSelect(products, _productId, pid => {
    _productId = pid;
    _renderGrid();
  });
  _prodContainerEl.appendChild(sel);
}

function _rebuildProductSelector() {
  _buildProductSelector();
}

// ── Private: grid ─────────────────────────────────────────────────────────────

function _renderGrid() {
  // Disconnect any existing observer before clearing the DOM
  if (_observer) { _observer.disconnect(); _observer = null; }
  _gridEl.innerHTML = '';

  if (!_productId) {
    _gridEl.appendChild(_emptyMsg('No hay productos disponibles.'));
    return;
  }

  const frames   = getFrames(_manifest, _regionKey, _productId);
  if (!frames.length) {
    _gridEl.appendChild(_emptyMsg('No hay imágenes para este producto.'));
    return;
  }

  const products  = getProducts(_manifest, _regionKey);
  const prod      = products[_productId];
  const prodLabel = prod?.label ?? _productId;

  // Pre-build lightbox item list for the whole product
  const lbItems = frames.map(f => {
    const ts = formatTimestamp(f.ts);
    return {
      url:     f.url,
      alt:     `${prodLabel} — ${ts.utcStr}`,
      caption: `${prodLabel} · ${ts.full}`,
    };
  });

  // Render cards
  frames.forEach((frame, idx) => {
    const card = _buildCard(frame, prodLabel, idx, lbItems);
    _gridEl.appendChild(card);
  });

  // Set up lazy loading via IntersectionObserver
  _observer = new IntersectionObserver(_onIntersect, { rootMargin: '400px' });
  _gridEl.querySelectorAll('.gallery-card').forEach(c => _observer.observe(c));
}

function _onIntersect(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const img = entry.target.querySelector('img[data-src]');
    if (img) {
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    }
    _observer.unobserve(entry.target);
  }
}

function _buildCard(frame, prodLabel, index, lbItems) {
  const ts = formatTimestamp(frame.ts);

  const card = document.createElement('div');
  card.className = 'gallery-card';
  card.setAttribute('role', 'listitem');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label',
    `Ver imagen ampliada: ${prodLabel} ${ts.utcStr}`);

  const _open = () => openLightbox(lbItems, index);
  card.addEventListener('click', _open);
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _open(); }
  });

  // ── Image wrap ─────────────────────────────────────────────
  const imgWrap = document.createElement('div');
  imgWrap.className = 'gallery-img-wrap';

  const skel = document.createElement('div');
  skel.className = 'skeleton gallery-skeleton';
  skel.setAttribute('aria-hidden', 'true');

  const img = document.createElement('img');
  img.className = 'gallery-img';
  img.alt       = `${prodLabel} — ${ts.utcStr}`;
  img.loading   = 'lazy';    // native fallback
  img.decoding  = 'async';
  img.width     = 320;
  img.height    = 240;
  // Data-src: IntersectionObserver will set src
  img.dataset.src = frame.url;

  img.addEventListener('load', () => {
    skel.remove();
    img.classList.add('loaded');
  });
  img.addEventListener('error', () => {
    skel.remove();
    imgWrap.classList.add('img-error');
    imgWrap.setAttribute('aria-label', 'Imagen no disponible');
  });

  // Timestamp overlay
  const overlay = document.createElement('div');
  overlay.className = 'gallery-overlay';
  overlay.setAttribute('aria-hidden', 'true');

  const utcSpan = document.createElement('span');
  utcSpan.className = 'ts-utc';
  utcSpan.textContent = ts.utcStr;

  const colSpan = document.createElement('span');
  colSpan.className = 'ts-col';
  colSpan.textContent = ts.colStr;

  overlay.append(utcSpan, colSpan);
  imgWrap.append(skel, img, overlay);
  card.appendChild(imgWrap);

  return card;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _emptyMsg(text) {
  const p = document.createElement('p');
  p.className = 'gallery-empty';
  p.textContent = text;
  return p;
}

function _label(text) {
  const el = document.createElement('label');
  el.className = 'control-label';
  el.textContent = text;
  return el;
}
