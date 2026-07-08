/**
 * timeline.js
 * Time-lapse player: frame-by-frame playback of satellite imagery.
 *
 * Features:
 *  - Play / Pause with large button
 *  - Speed control: 0.5× / 1× / 2× / 4×
 *  - Prev / Next frame navigation
 *  - Loop toggle
 *  - Range slider for direct frame scrubbing
 *  - Timestamp display in UTC and Colombia time (UTC−5)
 *  - Next-frame preloading for smooth playback
 *  - Click on viewer opens lightbox
 */

import { getProducts, getFrames, formatTimestamp } from './manifest.js?v=3';
import { buildRegionSelect, buildProductSelect, setActiveSegmented } from './selector.js?v=3';
import { openLightbox } from './lightbox.js?v=3';

const JPG_REGIONS = [
  { id: 'Colombia', label: 'Colombia' },
  { id: 'Global',   label: 'Global'   },
];

const SPEED_OPTIONS = [
  { value: 0.5, label: '0.5×' },
  { value: 1,   label: '1×'   },
  { value: 2,   label: '2×'   },
  { value: 4,   label: '4×'   },
];

/** Base interval in ms between frames at 1× speed. */
const BASE_INTERVAL = 700;

// ── Module state ──────────────────────────────────────────────────────────────

let _manifest   = null;
let _regionKey  = 'Colombia';
let _productId  = null;

/** @type {Array<{ts:string, url:string}>} */
let _frames     = [];
let _frameIndex = 0;
let _playing    = false;
let _speed      = 1;
let _loop       = true;

/** @type {number|null} setInterval handle */
let _timer = null;

// DOM references
let _viewerImg       = null;
let _viewerSkel      = null;
let _viewerError     = null;
let _slider          = null;
let _playBtn         = null;
let _tsDisplay       = null;
let _frameCounter    = null;
let _prodContainerEl = null;
let _preloadImg      = null;  // hidden Image used for prefetch

// ── Public ────────────────────────────────────────────────────────────────────

/**
 * Build and mount the Time-lapse tab content.
 * @param {HTMLElement} container
 * @param {Object}      manifest
 */
export function initTimeline(container, manifest) {
  _manifest   = manifest;
  _regionKey  = 'Colombia';
  _productId  = null;

  container.innerHTML = '';

  // ── Top controls ───────────────────────────────────────────
  const topRow = document.createElement('div');
  topRow.className = 'tl-top';

  const regionWrap = document.createElement('div');
  regionWrap.className = 'control-group';
  regionWrap.append(_label('Región'));
  regionWrap.appendChild(buildRegionSelect(JPG_REGIONS, _regionKey, rk => {
    _regionKey = rk;
    _rebuildProductSelector();
    _loadFrames();
  }));

  _prodContainerEl = document.createElement('div');
  _prodContainerEl.className = 'control-group';
  _buildProductSelector();

  topRow.append(regionWrap, _prodContainerEl);

  // ── Viewer ─────────────────────────────────────────────────
  const viewerWrap = document.createElement('div');
  viewerWrap.className = 'tl-viewer-wrap';

  _viewerSkel = document.createElement('div');
  _viewerSkel.className = 'skeleton tl-skeleton';
  _viewerSkel.setAttribute('aria-hidden', 'true');

  _viewerImg = document.createElement('img');
  _viewerImg.className = 'tl-viewer-img hidden';
  _viewerImg.alt = 'Fotograma del time-lapse';
  _viewerImg.setAttribute('decoding', 'async');
  _viewerImg.addEventListener('click', _openLightbox);
  _viewerImg.style.cursor = 'zoom-in';

  _viewerError = document.createElement('div');
  _viewerError.className = 'hero-error hidden';
  _viewerError.setAttribute('role', 'alert');
  _viewerError.innerHTML = `
    <span class="error-icon" aria-hidden="true">⚠</span>
    <span class="error-text">Imagen no disponible</span>
  `;

  viewerWrap.append(_viewerSkel, _viewerImg, _viewerError);

  // ── Timestamp & frame counter ──────────────────────────────
  _tsDisplay = document.createElement('div');
  _tsDisplay.className = 'tl-timestamp';
  _tsDisplay.setAttribute('aria-live', 'polite');
  _tsDisplay.setAttribute('aria-atomic', 'true');

  _frameCounter = document.createElement('div');
  _frameCounter.className = 'tl-frame-counter';

  // ── Slider ─────────────────────────────────────────────────
  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'tl-slider-wrap';

  _slider = document.createElement('input');
  _slider.type      = 'range';
  _slider.className = 'tl-slider';
  _slider.min       = '0';
  _slider.max       = '0';
  _slider.value     = '0';
  _slider.disabled  = true;
  _slider.setAttribute('aria-label', 'Fotograma actual');
  _slider.addEventListener('input', () => {
    _pause();
    _showFrame(parseInt(_slider.value, 10));
  });

  sliderWrap.appendChild(_slider);

  // ── Playback controls ──────────────────────────────────────
  const controls = document.createElement('div');
  controls.className = 'tl-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Controles de reproducción');

  const prevBtn = _makeBtn('tl-btn tl-btn-nav', '‹', 'Fotograma anterior', () => _step(-1));
  _playBtn = _makeBtn('tl-btn tl-btn-play', '▶', 'Reproducir', _togglePlay);
  const nextBtn = _makeBtn('tl-btn tl-btn-nav', '›', 'Siguiente fotograma', () => _step(1));

  // Speed segmented
  const speedWrap = document.createElement('div');
  speedWrap.className = 'tl-speed';
  speedWrap.appendChild(_label('Velocidad'));
  const speedGroup = _buildSpeedGroup();
  speedWrap.appendChild(speedGroup);

  // Loop toggle
  const loopWrap = document.createElement('div');
  loopWrap.className = 'tl-loop';
  const loopBtn = document.createElement('button');
  loopBtn.type = 'button';
  loopBtn.className = 'tl-btn tl-btn-loop' + (_loop ? ' active' : '');
  loopBtn.textContent = '↺ Bucle';
  loopBtn.setAttribute('aria-pressed', _loop ? 'true' : 'false');
  loopBtn.setAttribute('aria-label', 'Activar o desactivar bucle');
  loopBtn.addEventListener('click', () => {
    _loop = !_loop;
    loopBtn.classList.toggle('active', _loop);
    loopBtn.setAttribute('aria-pressed', _loop ? 'true' : 'false');
  });
  loopWrap.appendChild(loopBtn);

  controls.append(prevBtn, _playBtn, nextBtn, speedWrap, loopWrap);

  container.append(topRow, viewerWrap, _tsDisplay, _frameCounter, sliderWrap, controls);

  // Hidden Image for prefetching
  _preloadImg = new Image();

  _loadFrames();
}

/**
 * Pause playback.  Called externally by app.js when the user navigates
 * away from the time-lapse tab so the setInterval does not keep firing
 * and assigning _viewerImg.src in the background.
 */
export function pauseTimeline() {
  _pause();
}

// ── Private: product selector ─────────────────────────────────────────────────

function _buildProductSelector() {
  const products = getProducts(_manifest, _regionKey);
  if (!products[_productId]) {
    _productId = Object.keys(products)[0] ?? null;
  }

  _prodContainerEl.innerHTML = '';
  _prodContainerEl.appendChild(_label('Producto / Canal'));
  const sel = buildProductSelect(products, _productId, pid => {
    _productId = pid;
    _loadFrames();
  });
  _prodContainerEl.appendChild(sel);
}

function _rebuildProductSelector() {
  _buildProductSelector();
}

// ── Private: frame management ─────────────────────────────────────────────────

function _loadFrames() {
  _pause();
  _frames     = _productId ? getFrames(_manifest, _regionKey, _productId) : [];
  _frameIndex = 0;

  if (!_frames.length) {
    _viewerSkel.classList.add('hidden');
    _viewerImg.classList.add('hidden');
    _viewerError.classList.remove('hidden');
    _slider.disabled = true;
    _slider.max = '0';
    _tsDisplay.innerHTML  = '<span class="ts-utc" style="color:var(--text-dim)">Sin fotogramas disponibles</span>';
    _frameCounter.textContent = '';
    return;
  }

  _slider.max      = String(_frames.length - 1);
  _slider.value    = '0';
  _slider.disabled = false;

  _showFrame(0);
}

function _showFrame(index) {
  _frameIndex   = Math.max(0, Math.min(index, _frames.length - 1));
  _slider.value = String(_frameIndex);

  const frame = _frames[_frameIndex];
  if (!frame) return;

  // Show skeleton, hide image
  _viewerSkel.classList.remove('hidden');
  _viewerImg.classList.add('hidden');
  _viewerError.classList.add('hidden');

  _viewerImg.onload = () => {
    _viewerSkel.classList.add('hidden');
    _viewerImg.classList.remove('hidden');
    _prefetchNext();
  };
  _viewerImg.onerror = () => {
    _viewerSkel.classList.add('hidden');
    _viewerError.classList.remove('hidden');
    _prefetchNext();
  };
  _viewerImg.src = frame.url;
  _viewerImg.alt =
    `${_productId ?? 'Time-lapse'} — fotograma ${_frameIndex + 1} de ${_frames.length}`;

  // Update timestamp display
  const ts = formatTimestamp(frame.ts);
  _tsDisplay.innerHTML = `
    <span class="ts-utc">${ts.utcStr}</span>
    <span class="ts-separator" aria-hidden="true"> · </span>
    <span class="ts-col">${ts.colStr}</span>
  `;
  _frameCounter.textContent = `Fotograma ${_frameIndex + 1} de ${_frames.length}`;
}

function _prefetchNext() {
  const next = _frames[_frameIndex + 1];
  if (next && _preloadImg) _preloadImg.src = next.url;
}

function _step(delta) {
  const next = _frameIndex + delta;
  if (next < 0) {
    _showFrame(_loop ? _frames.length - 1 : 0);
  } else if (next >= _frames.length) {
    _showFrame(_loop ? 0 : _frames.length - 1);
  } else {
    _showFrame(next);
  }
}

// ── Private: playback ─────────────────────────────────────────────────────────

function _togglePlay() {
  _playing ? _pause() : _play();
}

function _play() {
  if (!_frames.length) return;
  _playing = true;
  _playBtn.innerHTML = '⏸';
  _playBtn.setAttribute('aria-label', 'Pausar');
  _startTimer();
}

function _pause() {
  _playing = false;
  if (_playBtn) {
    _playBtn.innerHTML = '▶';
    _playBtn.setAttribute('aria-label', 'Reproducir');
  }
  _stopTimer();
}

function _startTimer() {
  _stopTimer();
  _timer = setInterval(() => {
    let next = _frameIndex + 1;
    if (next >= _frames.length) {
      if (_loop) {
        next = 0;
      } else {
        _pause();
        return;
      }
    }
    _showFrame(next);
  }, BASE_INTERVAL / _speed);
}

function _stopTimer() {
  if (_timer !== null) { clearInterval(_timer); _timer = null; }
}

function _openLightbox() {
  if (!_frames.length) return;
  const products  = getProducts(_manifest, _regionKey);
  const prodLabel = products[_productId]?.label ?? _productId ?? '';
  const lbItems   = _frames.map(f => {
    const ts = formatTimestamp(f.ts);
    return {
      url:     f.url,
      alt:     `${prodLabel} — ${ts.utcStr}`,
      caption: `${prodLabel} · ${ts.full}`,
    };
  });
  openLightbox(lbItems, _frameIndex);
}

// ── Private: UI builders ──────────────────────────────────────────────────────

function _buildSpeedGroup() {
  const group = document.createElement('div');
  group.className = 'segmented-control segmented-sm';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Velocidad de reproducción');

  for (const opt of SPEED_OPTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.key = String(opt.value);
    btn.textContent = opt.label;
    btn.className = 'segmented-btn' + (opt.value === _speed ? ' active' : '');
    btn.setAttribute('aria-pressed', opt.value === _speed ? 'true' : 'false');
    btn.addEventListener('click', () => {
      setActiveSegmented(group, String(opt.value));
      _speed = opt.value;
      if (_playing) { _startTimer(); } // restart with new interval
    });
    group.appendChild(btn);
  }

  return group;
}

function _makeBtn(className, html, label, handler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.innerHTML = html;
  btn.setAttribute('aria-label', label);
  btn.addEventListener('click', handler);
  return btn;
}

function _label(text) {
  const el = document.createElement('span');
  el.className = 'control-label';
  el.textContent = text;
  return el;
}
