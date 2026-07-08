/**
 * lightbox.js
 * Fullscreen image overlay.
 *
 * Features:
 *  - ARIA modal with role="dialog" + aria-modal="true"
 *  - Focus trap (Tab / Shift+Tab)
 *  - Keyboard: Escape → close, ArrowLeft/Right → navigate
 *  - Returns focus to the triggering element on close
 *  - Works for both GIFs and JPGs (img tag, browser animates GIFs natively)
 */

// ── Private state ─────────────────────────────────────────────────────────────

/** @type {Array<{url:string, alt:string, caption?:string}>} */
let _items    = [];
let _index    = 0;
/** @type {HTMLElement|null} element that opened the lightbox */
let _originEl = null;

// DOM nodes (built once, reused)
let _overlay  = null;
let _img      = null;
let _skeleton = null;
let _caption  = null;
let _counter  = null;
let _prevBtn  = null;
let _nextBtn  = null;
let _closeBtn = null;

const FOCUSABLE_SEL = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Open the lightbox.
 * @param {Array<{url:string, alt:string, caption?:string}>} items
 * @param {number} startIndex
 */
export function openLightbox(items, startIndex = 0) {
  if (!items.length) return;

  _items    = items;
  _index    = Math.max(0, Math.min(startIndex, items.length - 1));
  _originEl = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;

  if (!_overlay) _buildDOM();

  // Mount into body if not already there
  if (!_overlay.parentElement) {
    document.body.appendChild(_overlay);
  }

  _overlay.removeAttribute('hidden');
  _overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  _showItem(_index);
  _closeBtn.focus();

  document.addEventListener('keydown', _handleKey);
}

/** Close the lightbox and return focus. */
export function closeLightbox() {
  if (!_overlay) return;

  _overlay.setAttribute('hidden', '');
  _overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', _handleKey);

  // Interrupt any pending image load (swap src to blank)
  if (_img) _img.src = '';

  if (_originEl) {
    try { _originEl.focus(); } catch { /* element may no longer be in DOM */ }
  }
}

// ── DOM builder ───────────────────────────────────────────────────────────────

function _buildDOM() {
  _overlay = document.createElement('div');
  _overlay.className = 'lb-overlay';
  _overlay.setAttribute('role', 'dialog');
  _overlay.setAttribute('aria-modal', 'true');
  _overlay.setAttribute('aria-label', 'Imagen ampliada');
  _overlay.setAttribute('hidden', '');
  _overlay.setAttribute('aria-hidden', 'true');

  // Click outside panel → close
  _overlay.addEventListener('click', e => {
    if (e.target === _overlay) closeLightbox();
  });

  // ── Panel ─────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'lb-panel';

  // Close button (absolute, floats above)
  _closeBtn = _makeBtn('lb-btn lb-close', '×', 'Cerrar imagen ampliada', closeLightbox);

  // Prev / Next
  _prevBtn = _makeBtn('lb-btn lb-prev', '‹', 'Imagen anterior', () => _navigate(-1));
  _nextBtn = _makeBtn('lb-btn lb-next', '›', 'Siguiente imagen', () => _navigate(1));

  // Image area
  const imgWrap = document.createElement('div');
  imgWrap.className = 'lb-img-wrap';

  _skeleton = document.createElement('div');
  _skeleton.className = 'skeleton lb-skeleton';
  _skeleton.setAttribute('aria-hidden', 'true');

  _img = document.createElement('img');
  _img.className = 'lb-img';
  _img.setAttribute('decoding', 'async');
  _img.addEventListener('load', () => {
    _skeleton.classList.add('hidden');
    _img.classList.remove('hidden');
  });
  _img.addEventListener('error', () => {
    _skeleton.classList.add('hidden');
    imgWrap.classList.add('lb-img-error-wrap');
  });

  imgWrap.append(_skeleton, _img);

  // Caption + counter row
  const info = document.createElement('div');
  info.className = 'lb-info';
  _caption = document.createElement('p');
  _caption.className = 'lb-caption';
  _counter = document.createElement('span');
  _counter.className = 'lb-counter';
  info.append(_caption, _counter);

  panel.append(_closeBtn, _prevBtn, imgWrap, _nextBtn, info);
  _overlay.appendChild(panel);
}

// ── Display logic ─────────────────────────────────────────────────────────────

function _showItem(index) {
  const item = _items[index];
  if (!item) return;

  // Reset image state
  _skeleton.classList.remove('hidden');
  _img.classList.add('hidden');
  _img.classList.remove('lb-img-error');
  _img.closest('.lb-img-wrap')?.classList.remove('lb-img-error-wrap');

  _img.alt = item.alt ?? '';
  _img.src = item.url;

  _caption.textContent = item.caption ?? item.alt ?? '';
  _counter.textContent = `${index + 1} / ${_items.length}`;

  const hasMany = _items.length > 1;
  _prevBtn.style.visibility = hasMany ? '' : 'hidden';
  _nextBtn.style.visibility = hasMany ? '' : 'hidden';
}

function _navigate(delta) {
  _index = (_index + delta + _items.length) % _items.length;
  _showItem(_index);
}

// ── Event handlers ────────────────────────────────────────────────────────────

function _handleKey(e) {
  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      closeLightbox();
      break;
    case 'ArrowLeft':
      if (_items.length > 1) { e.preventDefault(); _navigate(-1); }
      break;
    case 'ArrowRight':
      if (_items.length > 1) { e.preventDefault(); _navigate(1); }
      break;
    case 'Tab':
      _trapFocus(e);
      break;
  }
}

function _trapFocus(e) {
  if (!_overlay) return;
  const focusable = Array.from(_overlay.querySelectorAll(FOCUSABLE_SEL));
  if (!focusable.length) { e.preventDefault(); return; }

  const first = focusable[0];
  const last  = focusable[focusable.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _makeBtn(className, html, label, handler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.innerHTML = html;
  btn.setAttribute('aria-label', label);
  btn.addEventListener('click', handler);
  return btn;
}
