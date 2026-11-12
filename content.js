/**
 * Funda Social Housing Overlay - Content Script (v1.0.2)
 * High-performance spatial rendering over Funda's interactive map.
 */
(() => {
  console.log('%c[Funda Housing Overlay v1.0.2] Active on page.', 'color: #dc2626; font-weight: bold; font-size: 13px;');

  // Inject helper script into webpage context to intercept map events if available
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('inject.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}

  // Global settings
  const settings = {
    enabled: true,
    opacity: 0.70,
    minPercentage: 0,
    colorMode: 'risk', // 'risk' or 'corp'
    showTooltip: true
  };

  // Official AFWC Corporation Color Palette
  const CORP_COLORS = {
    'de Alliantie': '#FF0030',
    'DUWO': '#8A0B6E',
    'DUWO/Rochdale (DCR)': '#2AACD4',
    'Eigen Haard': '#EC81CF',
    'Habion': '#784C00',
    'Lieven de Key': '#D48A2A',
    'Rochdale': '#92A545',
    'Stadgenoot': '#02D52E',
    'Woonzorg': '#0E9466',
    'Ymere': '#3B66B8',
    'Brederode Wonen': '#DA9694',
    'Centrada': '#990000',
    'Dudok Wonen': '#0000FF',
    'Elan Wonen': '#FABBFA',
    'GoedeStede': '#F9E502',
    'Gooi en Omstreken': '#DECC00',
    'Intermaris': '#D93C7B',
    'Parteon': '#9C3CD9',
    'Pré Wonen': '#FF6600',
    'Wooncompagnie': '#FF8330',
    'Woonopmaat': '#7D9AFA',
    'WormerWonen': '#FF4A4A',
    'ZVH': '#C85C47'
  };

  let spatialIndex = null;
  let datasetLoaded = false;
  let currentBounds = null; // { west, south, east, north }
  let mapContainer = null;
  let canvas = null;
  let ctx = null;
  let animFrameId = null;
  let hudElement = null;
  let tooltipElement = null;
  let lastUrl = '';
  let hoveredFeature = null;

  // 1. Setup In-Page HUD attached directly to document.body
  function createHud() {
    if (document.getElementById('funda-housing-hud')) return;

    hudElement = document.createElement('div');
    hudElement.id = 'funda-housing-hud';
    hudElement.className = 'funda-housing-hud';

    hudElement.innerHTML = `
      <div class="funda-hud-header">
        <span class="funda-hud-title">🏘️ Social Housing</span>
        <button id="funda-hud-toggle" class="funda-hud-btn ${settings.enabled ? 'active' : ''}">
          ${settings.enabled ? 'ON' : 'OFF'}
        </button>
      </div>
      <div class="funda-hud-stats" id="funda-hud-stats">
        Loading housing database...
      </div>
      <div class="funda-hud-controls">
        <label>Filter: 
          <select id="funda-hud-filter">
            <option value="0" ${settings.minPercentage === 0 ? 'selected' : ''}>All Social Housing</option>
            <option value="50" ${settings.minPercentage === 50 ? 'selected' : ''}>≥ 50% Corporate</option>
            <option value="100" ${settings.minPercentage === 100 ? 'selected' : ''}>100% Corporate Only</option>
          </select>
        </label>
      </div>
    `;

    document.body.appendChild(hudElement);

    const toggleBtn = hudElement.querySelector('#funda-hud-toggle');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settings.enabled = !settings.enabled;
      chrome.storage.local.set({ enabled: settings.enabled });
      updateHudUi();
      scheduleRedraw();
    });

    const filterSelect = hudElement.querySelector('#funda-hud-filter');
    filterSelect.addEventListener('change', (e) => {
      settings.minPercentage = parseInt(e.target.value, 10);
      chrome.storage.local.set({ minPercentage: settings.minPercentage });
      scheduleRedraw();
    });
  }

  function updateHudUi() {
    if (!hudElement) return;
    const toggleBtn = hudElement.querySelector('#funda-hud-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = settings.enabled ? 'ON' : 'OFF';
      toggleBtn.className = `funda-hud-btn ${settings.enabled ? 'active' : ''}`;
    }
  }

  function updateHudStats(text) {
    if (!hudElement) return;
    const stats = hudElement.querySelector('#funda-hud-stats');
    if (stats) stats.textContent = text;
  }

  // 2. Load User Settings
  chrome.storage.local.get(settings, (stored) => {
    Object.assign(settings, stored);
    updateHudUi();
    scheduleRedraw();
  });

  chrome.storage.onChanged.addListener((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      if (key in settings) {
        settings[key] = change.newValue;
      }
    }
    updateHudUi();
    scheduleRedraw();
  });

  // 3. Load Housing Dataset into Spatial Grid Index
  async function loadData() {
    try {
      updateHudStats('Loading 38,293 AFWC blocks...');
      const url = chrome.runtime.getURL('data/social_housing.json');
      const res = await fetch(url);
      const data = await res.json();
      spatialIndex = new window.SpatialIndex(0.01);
      spatialIndex.load(data);
      datasetLoaded = true;
      console.log(`%c[Funda Housing Overlay] Indexed ${data.length} building blocks.`, 'color: #16a34a; font-weight: bold;');
      scanAndSetupMap();
      scheduleRedraw();
    } catch (err) {
      console.error('[Funda Housing Overlay] Failed to load data:', err);
      updateHudStats('Error loading dataset');
    }
  }

  // 4. Web Mercator projection helpers
  function lat2y(lat) {
    const rad = (lat * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + rad / 2));
  }

  function y2lat(y) {
    return (Math.atan(Math.exp(y)) * 2 - Math.PI / 2) * (180 / Math.PI);
  }

  // 5. Robust Map Container Detection
  function findMapContainer() {
    // Strategy 1: Active Mapbox/MapLibre canvas or WebGL canvas
    const canvases = document.querySelectorAll('canvas');
    for (const c of canvases) {
      if (c.id === 'funda-social-housing-canvas') continue;
      const rect = c.getBoundingClientRect();
      if (rect.width > 250 && rect.height > 250) {
        // Return this exact canvas element as target!
        return c;
      }
    }

    // Strategy 2: Common map container class names
    const classSelectors = [
      '.mapboxgl-map',
      '.maplibregl-map',
      '.leaflet-container',
      '.gm-style',
      'div[class*="SearchMap" i]',
      'div[class*="search-result-map" i]',
      'div[data-testid*="map" i]',
      'div[data-testid*="kaart" i]',
      'div[class*="kaart" i]',
      'div[class*="map-container" i]',
      '#map-container',
      '#kaart',
      '#map'
    ];

    for (const sel of classSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 200) {
          return el;
        }
      }
    }

    // Strategy 3: Large interactive area
    const allDivs = document.querySelectorAll('div, section, main');
    let bestCandidate = null;
    let maxArea = 0;

    for (const d of allDivs) {
      if (d === hudElement || d.contains(hudElement)) continue;
      const rect = d.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (rect.width > 350 && rect.height > 350 && area > maxArea) {
        if (d.querySelector('canvas, svg, img[src*="tile"], [class*="marker" i]')) {
          maxArea = area;
          bestCandidate = d;
        }
      }
    }

    return bestCandidate;
  }

  // 6. Setup Canvas Overlay - ATTACHED TO BODY AS FIXED OVERLAY (NEVER COVERED BY TILES!)
  function scanAndSetupMap() {
    const container = findMapContainer();
    if (!container) return;

    if (mapContainer !== container) {
      mapContainer = container;
      console.log('%c[Funda Housing Overlay] Target map element identified:', 'color: #2563eb;', container);

      if (canvas && canvas.parentElement) canvas.remove();

      canvas = document.createElement('canvas');
      canvas.id = 'funda-social-housing-canvas';
      canvas.className = 'funda-housing-overlay';

      // Always append to document.body with position: fixed and highest z-index!
      document.body.appendChild(canvas);
      ctx = canvas.getContext('2d');

      setupEventListeners(container);
      setupTooltip();
    }

    syncCanvasPosition();
    scheduleRedraw();
  }

  function syncCanvasPosition() {
    if (!canvas || !mapContainer) return;
    const rect = mapContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    if (w <= 0 || h <= 0) return;

    // Position fixed directly over the map container on the screen
    canvas.style.position = 'fixed';
    canvas.style.top = `${rect.top}px`;
    canvas.style.left = `${rect.left}px`;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '999999';

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
  }

  // 7. Parse Bounding Box from Funda URL
  function parseUrlBounds() {
    try {
      const url = new URL(window.location.href);
      const tlLat = parseFloat(url.searchParams.get('top_left_lat'));
      const tlLng = parseFloat(url.searchParams.get('top_left_lng'));
      const brLat = parseFloat(url.searchParams.get('bottom_right_lat'));
      const brLng = parseFloat(url.searchParams.get('bottom_right_lng'));

      if (!isNaN(tlLat) && !isNaN(tlLng) && !isNaN(brLat) && !isNaN(brLng)) {
        return {
          west: Math.min(tlLng, brLng),
          south: Math.min(tlLat, brLat),
          east: Math.max(tlLng, brLng),
          north: Math.max(tlLat, brLat)
        };
      }
    } catch (e) {}
    return null;
  }

  // 8. Listen to updates from inject.js
  window.addEventListener('__funda_map_update__', (e) => {
    if (e.detail && e.detail.bounds) {
      currentBounds = e.detail.bounds;
      scheduleRedraw();
    }
  });

  function checkUrlSync() {
    syncCanvasPosition();
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      const b = parseUrlBounds();
      if (b) {
        currentBounds = b;
        scheduleRedraw();
      }
    }
    if (!mapContainer || !document.contains(mapContainer)) {
      scanAndSetupMap();
    }
  }

  // 9. Render Polygons on Canvas
  function scheduleRedraw() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(render);
  }

  function render() {
    animFrameId = null;
    if (!canvas || !ctx || !mapContainer) {
      scanAndSetupMap();
      if (!canvas || !ctx || !mapContainer) return;
    }

    syncCanvasPosition();
    const rect = mapContainer.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (width <= 0 || height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!settings.enabled) {
      updateHudStats('Overlay is OFF');
      ctx.restore();
      return;
    }

    if (!datasetLoaded || !spatialIndex) {
      updateHudStats('Loading data...');
      ctx.restore();
      return;
    }

    const b = currentBounds || parseUrlBounds();
    if (!b) {
      updateHudStats('Waiting for map view...');
      ctx.restore();
      return;
    }

    // Query visible features from spatial index
    const features = spatialIndex.search(b.west, b.south, b.east, b.north);

    if (!features.length) {
      updateHudStats('0 corporate blocks in this view');
      ctx.restore();
      return;
    }

    updateHudStats(`${features.length.toLocaleString()} corporate blocks visible`);

    const topY = lat2y(b.north);
    const botY = lat2y(b.south);
    const lngSpan = b.east - b.west;
    const ySpan = topY - botY;

    if (lngSpan <= 0 || ySpan <= 0) {
      ctx.restore();
      return;
    }

    function projectPoint(lng, lat) {
      const px = ((lng - b.west) / lngSpan) * width;
      const py = ((topY - lat2y(lat)) / ySpan) * height;
      return [px, py];
    }

    const minPct = settings.minPercentage;
    const baseOpacity = settings.opacity;

    // Draw visible polygons
    for (let i = 0; i < features.length; i++) {
      const feat = features[i];
      if (feat.p < minPct) continue;

      let fillColor;
      let strokeColor;

      if (settings.colorMode === 'corp') {
        const cHex = CORP_COLORS[feat.c] || '#e11d48';
        fillColor = hexToRgba(cHex, baseOpacity);
        strokeColor = cHex;
      } else {
        // High-Visibility Vivid Red & Amber Risk Alert
        if (feat.p >= 100) {
          fillColor = `rgba(220, 38, 38, ${baseOpacity})`;       // Strong vivid red
          strokeColor = '#991b1b';
        } else if (feat.p >= 75) {
          fillColor = `rgba(234, 88, 12, ${baseOpacity * 0.95})`; // Orange-red
          strokeColor = '#c2410c';
        } else if (feat.p >= 50) {
          fillColor = `rgba(245, 158, 11, ${baseOpacity * 0.9})`; // Amber
          strokeColor = '#b45309';
        } else {
          fillColor = `rgba(234, 179, 8, ${baseOpacity * 0.8})`;  // Soft amber
          strokeColor = '#a16207';
        }
      }

      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2.0;

      const geom = feat.g;
      if (geom.type === 'Polygon') {
        drawPolygon(geom.coordinates, projectPoint);
      } else if (geom.type === 'MultiPolygon') {
        for (let m = 0; m < geom.coordinates.length; m++) {
          drawPolygon(geom.coordinates[m], projectPoint);
        }
      }
    }

    // Highlight hovered feature if any
    if (hoveredFeature) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 3.5;
      const geom = hoveredFeature.g;
      if (geom.type === 'Polygon') {
        drawPolygon(geom.coordinates, projectPoint);
      } else if (geom.type === 'MultiPolygon') {
        for (let m = 0; m < geom.coordinates.length; m++) {
          drawPolygon(geom.coordinates[m], projectPoint);
        }
      }
    }

    ctx.restore();
  }

  function drawPolygon(rings, projectPoint) {
    if (!rings || !rings.length) return;
    ctx.beginPath();

    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      if (!ring.length) continue;

      const first = projectPoint(ring[0][0], ring[0][1]);
      ctx.moveTo(first[0], first[1]);

      for (let p = 1; p < ring.length; p++) {
        const pt = projectPoint(ring[p][0], ring[p][1]);
        ctx.lineTo(pt[0], pt[1]);
      }
      ctx.closePath();
    }
    ctx.fill('evenodd');
    ctx.stroke();
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // 10. Interactive Hover Tooltip
  function setupTooltip() {
    if (document.getElementById('funda-housing-tooltip')) return;
    tooltipElement = document.createElement('div');
    tooltipElement.id = 'funda-housing-tooltip';
    tooltipElement.className = 'funda-housing-tooltip';
    document.body.appendChild(tooltipElement);
  }

  function setupEventListeners(container) {
    // Listen on window / document so mouse events are never missed
    window.addEventListener('mousemove', (e) => {
      if (!settings.enabled || !spatialIndex || !mapContainer) {
        hideTooltip();
        return;
      }

      const rect = mapContainer.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
        if (hoveredFeature) {
          hoveredFeature = null;
          scheduleRedraw();
        }
        hideTooltip();
        return;
      }

      const b = currentBounds || parseUrlBounds();
      if (!b) return;

      const topY = lat2y(b.north);
      const botY = lat2y(b.south);
      const lng = b.west + (x / rect.width) * (b.east - b.west);
      const mercY = topY - (y / rect.height) * (topY - botY);
      const lat = y2lat(mercY);

      const hit = spatialIndex.findAt(lng, lat);
      if (hit && hit.p >= settings.minPercentage) {
        if (hoveredFeature !== hit) {
          hoveredFeature = hit;
          scheduleRedraw();
        }
        if (settings.showTooltip) {
          showTooltip(e.clientX, e.clientY, hit);
        }
      } else {
        if (hoveredFeature) {
          hoveredFeature = null;
          scheduleRedraw();
        }
        hideTooltip();
      }
    });

    window.addEventListener('mouseleave', () => {
      hoveredFeature = null;
      hideTooltip();
      scheduleRedraw();
    });

    window.addEventListener('resize', () => {
      syncCanvasPosition();
      scheduleRedraw();
    });

    window.addEventListener('scroll', () => {
      syncCanvasPosition();
      scheduleRedraw();
    }, { passive: true });

    window.addEventListener('wheel', () => setTimeout(checkUrlSync, 60), { passive: true });
    window.addEventListener('mouseup', () => setTimeout(checkUrlSync, 60), { passive: true });
    window.addEventListener('touchend', () => setTimeout(checkUrlSync, 60), { passive: true });
  }

  function showTooltip(clientX, clientY, feat) {
    if (!tooltipElement) return;
    tooltipElement.innerHTML = `
      <div class="funda-tip-title">🏢 ${escapeHtml(feat.c)}</div>
      <div class="funda-tip-row">
        <span class="funda-tip-badge ${feat.p >= 100 ? 'danger' : 'warn'}">${feat.p}% Social Housing</span>
      </div>
      <div class="funda-tip-meta">
        Units: <strong>${feat.cw}</strong> of ${feat.tw || feat.cw} in block
      </div>
    `;
    tooltipElement.style.left = `${clientX + 14}px`;
    tooltipElement.style.top = `${clientY + 14}px`;
    tooltipElement.style.display = 'block';
  }

  function hideTooltip() {
    if (tooltipElement) tooltipElement.style.display = 'none';
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 11. Sync Timers & Observers
  setInterval(checkUrlSync, 100);

  const observer = new MutationObserver(() => {
    if (!mapContainer || !document.contains(mapContainer)) {
      scanAndSetupMap();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Init
  createHud();
  loadData();
})();
