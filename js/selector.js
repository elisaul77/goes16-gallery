/**
 * selector.js
 * Reusable UI component builders for region, category, and product selectors.
 * All functions are pure — they return DOM elements; callers own the DOM.
 */

// ── Region <select> ──────────────────────────────────────────────────────────

/**
 * Build a native <select> for a list of regions.
 *
 * @param {Array<{id:string, label:string}>} regions
 * @param {string}   selected  - id of the initially selected option
 * @param {Function} onChange  - callback(regionId: string)
 * @returns {HTMLSelectElement}
 */
export function buildRegionSelect(regions, selected, onChange) {
  const sel = document.createElement('select');
  sel.className = 'selector-select';
  sel.setAttribute('aria-label', 'Seleccionar región');

  for (const r of regions) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.label;
    if (r.id === selected) opt.selected = true;
    sel.appendChild(opt);
  }

  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

// ── Category segmented control ───────────────────────────────────────────────

/**
 * Build a button-group (segmented control) for GIF categories.
 * Each button's dataset.key holds the category key.
 *
 * @param {Object}   categories - manifest.gifs.categories
 * @param {string}   selected   - initially active category key
 * @param {Function} onChange   - callback(categoryKey: string)
 * @returns {HTMLElement}  — the wrapper div (.segmented-control)
 */
export function buildCategorySegmented(categories, selected, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'segmented-control';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Tipo de imagen');

  for (const [key, cat] of Object.entries(categories)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.key = key;
    btn.textContent = cat.label;
    btn.className = 'segmented-btn' + (key === selected ? ' active' : '');
    btn.setAttribute('aria-pressed', key === selected ? 'true' : 'false');

    btn.addEventListener('click', () => {
      setActiveSegmented(wrap, key);
      onChange(key);
    });

    wrap.appendChild(btn);
  }

  return wrap;
}

/**
 * Programmatically update the active button of a segmented control.
 * Safe to call even if key is already active (idempotent).
 *
 * @param {HTMLElement} groupEl  - the .segmented-control wrapper
 * @param {string}      key      - dataset.key of the button to activate
 */
export function setActiveSegmented(groupEl, key) {
  groupEl.querySelectorAll('.segmented-btn').forEach(btn => {
    const active = btn.dataset.key === key;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

// ── Product <select> (grouped) ───────────────────────────────────────────────

/**
 * Build a grouped <select> for region products.
 * Options are split into two <optgroup>s: channels (type=channel) and
 * derived products (type=product).
 *
 * @param {Object}   products  - keyed product map from manifest
 * @param {string}   selected  - initially selected product id
 * @param {Function} onChange  - callback(productId: string)
 * @returns {HTMLSelectElement}
 */
export function buildProductSelect(products, selected, onChange) {
  const sel = document.createElement('select');
  sel.className = 'selector-select';
  sel.setAttribute('aria-label', 'Seleccionar producto o canal');

  const grpChannels = document.createElement('optgroup');
  grpChannels.label = 'Canales (C01–C16)';

  const grpDerived = document.createElement('optgroup');
  grpDerived.label = 'Productos derivados';

  for (const [id, prod] of Object.entries(products)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${id} — ${prod.label}`;
    if (id === selected) opt.selected = true;
    (prod.type === 'channel' ? grpChannels : grpDerived).appendChild(opt);
  }

  if (grpChannels.children.length) sel.appendChild(grpChannels);
  if (grpDerived.children.length)  sel.appendChild(grpDerived);

  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}
