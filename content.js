/**
 * Social Housing Overlay - Content Script (v1.2.2)
 * High-performance spatial rendering over Funda and Google Maps.
 * Features:
 * - Dynamic border opacity linked to overall layer opacity.
 * - Disappears overlay instantly during panning/moving until new coordinates are recalculated.
 */
(() => {
  const isGoogle = window.location.hostname.includes('google');
  console.log(`%c[Social Housing Overlay v1.2.2] Active on ${isGoogle ? 'Google Maps' : 'Funda'}.`, 'color: #dc2626; font-weight: bold; font-size: 13px;');

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
    opacity: 0.60,
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
  let wheelDebounceTimer = null;

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
      console.log(`%c[Social Housing Overlay] Indexed ${data.length} building blocks.`, 'color: #16a34a; font-weight: bold;');
      scanAndSetupMap();
      scheduleRedraw();
    } catch (err) {
      console.error('[Social Housing Overlay] Failed to load data:', err);
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

  function getBoundsFromCenterZoom(centerLat, centerLng, zoom, width, height) {
    const worldSize = 256 * Math.pow(2, zoom);
    const centerX = ((centerLng + 180) / 360) * worldSize;
    const centerY = (0.5 - lat2y(centerLat) / (2 * Math.PI)) * worldSize;

    const minX = centerX - width / 2;
    const maxX = centerX + width / 2;
    const minY = centerY - height / 2;
    const maxY = centerY + height / 2;

    const west = (minX / worldSize) * 360 - 180;
    const east = (maxX / worldSize) * 360 - 180;
    const north = y2lat(Math.PI * (1 - (2 * minY) / worldSize));
    const south = y2lat(Math.PI * (1 - (2 * maxY) / worldSize));

    return { west, south, east, north };
  }

  // 5. Robust Map Container Detection (Funda + Google Maps)
  function findMapContainer() {
    // Strategy 1: Active map canvas (Mapbox GL on Funda, WebGL on Google Maps)
    const canvases = document.querySelectorAll('canvas');
    for (const c of canvases) {
      if (c.id === 'funda-social-housing-canvas') continue;
      const rect = c.getBoundingClientRect();
      if (rect.width > 250 && rect.height > 250) {
        return c;
      }
    }

    // Strategy 2: Google Maps scene containers
    const gScene = document.querySelector('#scene, .widget-scene, .widget-scene-canvas, #content-container');
    if (gScene) {
      const rect = gScene.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 200) return gScene;
    }

    // Strategy 3: Common class names
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

    return null;
  }

  // 6. Setup Canvas Overlay: Fixed root layer on document.body
  function scanAndSetupMap() {
    const container = findMapContainer();
    if (!container) return;

    if (mapContainer !== container) {
      mapContainer = container;
      console.log('%c[Social Housing Overlay] Map element identified:', 'color: #2563eb;', container);

      if (canvas && canvas.parentElement) canvas.remove();

      canvas = document.createElement('canvas');
      canvas.id = 'funda-social-housing-canvas';
      canvas.className = 'funda-housing-overlay';

      document.body.appendChild(canvas);
      ctx = canvas.getContext('2d');

      setupEventListeners();
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

  // Clear overlay immediately during movement/pan so no stale polygons remain visible
  function clearOverlay() {
    if (!canvas || !ctx || !mapContainer) return;
    const rect = mapContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.restore();
    if (hoveredFeature) {
      hoveredFeature = null;
      hideTooltip();
    }
  }

  // 7. Parse Bounding Box from URL (supports both Funda and Google Maps)
  function parseUrlBounds() {
    try {
      const url = window.location.href;

      // 1. Funda bounding box parameters
      if (url.includes('top_left_lat')) {
        const u = new URL(url);
        const tlLat = parseFloat(u.searchParams.get('top_left_lat'));
        const tlLng = parseFloat(u.searchParams.get('top_left_lng'));
        const brLat = parseFloat(u.searchParams.get('bottom_right_lat'));
        const brLng = parseFloat(u.searchParams.get('bottom_right_lng'));

        if (!isNaN(tlLat) && !isNaN(tlLng) && !isNaN(brLat) && !isNaN(brLng)) {
          return {
            west: Math.min(tlLng, brLng),
            south: Math.min(tlLat, brLat),
            east: Math.max(tlLng, brLng),
            north: Math.max(tlLat, brLat)
          };
        }
      }

      // 2. Google Maps URL (@lat,lng,zoomz or @lat,lng,altm)
      const rect = mapContainer ? mapContainer.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
      const w = rect.width || window.innerWidth;
      const h = rect.height || window.innerHeight;

      const matchZoom = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+(?:\.\d+)?)z/);
      if (matchZoom) {
        const lat = parseFloat(matchZoom[1]);
        const lng = parseFloat(matchZoom[2]);
        const z = parseFloat(matchZoom[3]);
        return getBoundsFromCenterZoom(lat, lng, z, w, h);
      }

      const matchMeters = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+(?:\.\d+)?)m/);
      if (matchMeters) {
        const lat = parseFloat(matchMeters[1]);
        const lng = parseFloat(matchMeters[2]);
        const meters = parseFloat(matchMeters[3]);
        const z = Math.log2(352000000 / meters);
        return getBoundsFromCenterZoom(lat, lng, z, w, h);
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

    // Both fill and border opacity scale proportionally with user opacity slider!
    const strokeAlpha = Math.min(1.0, baseOpacity * 1.25);
    const dynamicLineWidth = Math.max(0.8, 1.8 * Math.min(1.0, baseOpacity + 0.2));

    // Draw visible polygons
    for (let i = 0; i < features.length; i++) {
      const feat = features[i];
      if (feat.p < minPct) continue;

      let fillColor;
      let strokeColor;

      if (settings.colorMode === 'corp') {
        const cHex = CORP_COLORS[feat.c] || '#e11d48';
        fillColor = hexToRgba(cHex, baseOpacity);
        strokeColor = hexToRgba(cHex, strokeAlpha);
      } else {
        // High-Visibility Vivid Red & Amber Risk Alert with dynamic border alpha
        if (feat.p >= 100) {
          fillColor = `rgba(220, 38, 38, ${baseOpacity})`;
          strokeColor = `rgba(153, 27, 27, ${strokeAlpha})`;
        } else if (feat.p >= 75) {
          fillColor = `rgba(234, 88, 12, ${baseOpacity * 0.95})`;
          strokeColor = `rgba(194, 65, 12, ${strokeAlpha})`;
        } else if (feat.p >= 50) {
          fillColor = `rgba(245, 158, 11, ${baseOpacity * 0.9})`;
          strokeColor = `rgba(180, 83, 9, ${strokeAlpha})`;
        } else {
          fillColor = `rgba(234, 179, 8, ${baseOpacity * 0.8})`;
          strokeColor = `rgba(161, 98, 7, ${strokeAlpha})`;
        }
      }

      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = dynamicLineWidth;

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

  function setupEventListeners() {
    // 1. Immediately disappear overlay when user starts dragging/panning
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && mapContainer) {
        const rect = mapContainer.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom) {
          clearOverlay();
        }
      }
    });

    // 2. Immediately disappear overlay when user scrolls wheel to zoom
    window.addEventListener('wheel', (e) => {
      if (!mapContainer) return;
      const rect = mapContainer.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        clearOverlay();
        clearTimeout(wheelDebounceTimer);
        wheelDebounceTimer = setTimeout(() => {
          checkUrlSync();
        }, 120);
      }
    }, { passive: true });

    // Touch support (mobile / touchpads)
    window.addEventListener('touchstart', () => {
      if (mapContainer) clearOverlay();
    }, { passive: true });

    window.addEventListener('mousemove', (e) => {
      // Hover tooltip logic
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

    window.addEventListener('mouseup', () => {
      setTimeout(checkUrlSync, 40);
    });

    window.addEventListener('touchend', () => {
      setTimeout(checkUrlSync, 40);
    });

    window.addEventListener('resize', () => {
      syncCanvasPosition();
      scheduleRedraw();
    });

    window.addEventListener('scroll', () => {
      syncCanvasPosition();
      scheduleRedraw();
    }, { passive: true });
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

  // 11. Continuous Fast Sync Timer
  setInterval(checkUrlSync, 80);

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
