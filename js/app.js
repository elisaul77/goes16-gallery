/**
 * app.js
 * Application entry point.
 *
 * Responsibilities:
 *  1. Generate CSS star background and inject into <head>
 *  2. Load manifest (with fallback)
 *  3. Render "Updated N min ago" ticker in header
 *  4. Initialize tab navigation with ARIA and hash routing
 *  5. Lazy-initialize each tab panel on first activation
 */

import { loadManifest }               from './manifest.js?v=3';
import { initGifs }                   from './gifs.js?v=3';
import { initGallery }                from './gallery.js?v=3';
import { initTimeline, pauseTimeline } from './timeline.js?v=3';

// ── Tab configuration ─────────────────────────────────────────────────────────

const TABS = ['animaciones', 'galeria', 'timelapse'];

// ── Star background ───────────────────────────────────────────────────────────

/**
 * Generate an array of random CSS box-shadow values that simulate stars.
 * Uses pixel positions relative to a 1920×1080 reference canvas.
 * @param {number} count
 * @returns {string}  comma-separated box-shadow value list
 */
function generateStars(count) {
  const W = 1920;
  const H = 1080;
  const stars = [];

  // Deterministic-looking but visually random via a simple LCG seed
  let seed = 42;
  function rand() {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  }

  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * H);
    const s = (rand() * 1.4 + 0.3).toFixed(1);
    const o = (rand() * 0.55 + 0.15).toFixed(2);
    stars.push(`${x}px ${y}px 0 ${s}px rgba(255,255,255,${o})`);
  }

  return stars.join(',');
}

function injectStars() {
  // Don't animate/disturb users who prefer reduced motion
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const count   = reduced ? 80 : 200;

  const style = document.createElement('style');
  style.dataset.stars = 'true';
  style.textContent = `.stars-layer::after{box-shadow:${generateStars(count)}}`;
  document.head.appendChild(style);
}

// ── "Updated N minutes ago" ticker ────────────────────────────────────────────

function startAgoTicker(generatedUtc) {
  const el = document.getElementById('updated-ago');
  if (!el) return;

  const genTime = new Date(generatedUtc).getTime();

  function tick() {
    const diff = Date.now() - genTime;
    const min  = Math.floor(diff / 60_000);

    if (diff < 60_000) {
      el.textContent = 'Actualizado hace menos de 1 min';
    } else if (min < 60) {
      el.textContent = `Actualizado hace ${min} min`;
    } else {
      const h = Math.floor(min / 60);
      const m = min % 60;
      el.textContent = `Actualizado hace ${h}h${m > 0 ? ` ${m}min` : ''}`;
    }
  }

  tick();
  // Refresh every 60 s — no need for finer granularity
  setInterval(tick, 60_000);
}

// ── Tab navigation ────────────────────────────────────────────────────────────

function initTabs(manifest) {
  const tabBtns   = Array.from(document.querySelectorAll('[role="tab"]'));
  const tabPanels = Array.from(document.querySelectorAll('[role="tabpanel"]'));

  function activateTab(tabId) {
    // Pause time-lapse if navigating away from it, so the setInterval does
    // not keep firing and modifying _viewerImg.src in the background.
    const prevTab = tabBtns.find(b => b.getAttribute('aria-selected') === 'true');
    if (prevTab?.dataset.tab === 'timelapse' && tabId !== 'timelapse') {
      pauseTimeline();
    }

    // Update tab buttons
    tabBtns.forEach(btn => {
      const active = btn.dataset.tab === tabId;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.setAttribute('tabindex', active ? '0' : '-1');
    });

    // Update panels
    tabPanels.forEach(panel => {
      const active = panel.id === `panel-${tabId}`;
      panel.hidden = !active;
    });

    // Lazy-init the panel on first activation
    const panel = document.getElementById(`panel-${tabId}`);
    if (!panel || panel.dataset.initialized === 'true') return;
    panel.dataset.initialized = 'true';

    switch (tabId) {
      case 'animaciones':
        initGifs(panel, manifest, { region: 'COLOMBIA', category: 'VISUAL' });
        break;
      case 'galeria':
        initGallery(panel, manifest);
        break;
      case 'timelapse':
        initTimeline(panel, manifest);
        break;
    }
  }

  // Click handler
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      activateTab(id);
      // Update URL hash without scrolling
      history.replaceState(null, '', `#${id}`);
    });
  });

  // Arrow-key navigation within the tablist (ARIA pattern)
  tabBtns.forEach((btn, i) => {
    btn.addEventListener('keydown', e => {
      let target = -1;
      if (e.key === 'ArrowRight') target = (i + 1) % tabBtns.length;
      if (e.key === 'ArrowLeft')  target = (i - 1 + tabBtns.length) % tabBtns.length;
      if (e.key === 'Home')       target = 0;
      if (e.key === 'End')        target = tabBtns.length - 1;
      if (target >= 0) {
        e.preventDefault();
        tabBtns[target].focus();
        tabBtns[target].click();
      }
    });
  });

  // Route from URL hash, default to 'animaciones'
  const hash    = location.hash.slice(1);
  const initial = TABS.includes(hash) ? hash : 'animaciones';
  activateTab(initial);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  injectStars();

  const loadingEl = document.getElementById('app-loading');
  const errorEl   = document.getElementById('app-error');
  const appEl     = document.getElementById('app');

  try {
    const manifest = await loadManifest();

    // Hide loading overlay, reveal app
    if (loadingEl) loadingEl.hidden = true;
    if (appEl)     appEl.hidden = false;

    startAgoTicker(manifest.generated_utc);
    initTabs(manifest);

  } catch (err) {
    console.error('[GOES-16] Bootstrap failed:', err);

    if (loadingEl) loadingEl.hidden = true;

    if (errorEl) {
      errorEl.hidden = false;
      const msgEl = errorEl.querySelector('.error-message');
      if (msgEl) msgEl.textContent = err.message;
    }
  }
}

bootstrap();
