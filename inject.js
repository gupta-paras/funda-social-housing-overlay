/**
 * Injected script running in the webpage MAIN world.
 * Hooks into Funda's map engine (Mapbox GL, MapLibre, Leaflet, or Google Maps)
 * and relays real-time coordinate transformations and camera updates to content.js.
 */
(() => {
  function dispatchMapUpdate(bounds, zoom, center) {
    window.dispatchEvent(new CustomEvent('__funda_map_update__', {
      detail: {
        bounds: bounds, // { west, south, east, north }
        zoom: zoom,
        center: center,
        timestamp: Date.now()
      }
    }));
  }

  // Intercept Mapbox / MapLibre GL
  function hookMapbox(mapboxObj) {
    if (!mapboxObj || mapboxObj.__funda_hooked) return;
    mapboxObj.__funda_hooked = true;

    const originalMap = mapboxObj.Map;
    if (!originalMap) return;

    mapboxObj.Map = function (...args) {
      const mapInstance = new originalMap(...args);
      window.__funda_mapbox_instance__ = mapInstance;

      const reportBounds = () => {
        try {
          const b = mapInstance.getBounds();
          const z = mapInstance.getZoom();
          const c = mapInstance.getCenter();
          dispatchMapUpdate({
            west: b.getWest(),
            south: b.getSouth(),
            east: b.getEast(),
            north: b.getNorth()
          }, z, { lng: c.lng, lat: c.lat });
        } catch (e) {}
      };

      mapInstance.on('load', reportBounds);
      mapInstance.on('move', reportBounds);
      mapInstance.on('zoom', reportBounds);
      mapInstance.on('moveend', reportBounds);
      mapInstance.on('resize', reportBounds);

      return mapInstance;
    };
    mapboxObj.Map.prototype = originalMap.prototype;
  }

  // Intercept Leaflet
  function hookLeaflet(leafletObj) {
    if (!leafletObj || leafletObj.__funda_hooked) return;
    leafletObj.__funda_hooked = true;

    const originalMap = leafletObj.Map;
    if (!originalMap) return;

    leafletObj.Map = function (...args) {
      const mapInstance = new originalMap(...args);
      window.__funda_leaflet_instance__ = mapInstance;

      const reportBounds = () => {
        try {
          const b = mapInstance.getBounds();
          const z = mapInstance.getZoom();
          const c = mapInstance.getCenter();
          dispatchMapUpdate({
            west: b.getWest(),
            south: b.getSouth(),
            east: b.getEast(),
            north: b.getNorth()
          }, z, { lng: c.lng, lat: c.lat });
        } catch (e) {}
      };

      mapInstance.on('move', reportBounds);
      mapInstance.on('zoom', reportBounds);
      mapInstance.on('moveend', reportBounds);

      return mapInstance;
    };
    leafletObj.Map.prototype = originalMap.prototype;
  }

  // Monitor window objects
  if (window.mapboxgl) hookMapbox(window.mapboxgl);
  if (window.maplibregl) hookMapbox(window.maplibregl);
  if (window.L) hookLeaflet(window.L);

  let currentMapbox = window.mapboxgl;
  Object.defineProperty(window, 'mapboxgl', {
    configurable: true,
    enumerable: true,
    get: () => currentMapbox,
    set: (val) => {
      currentMapbox = val;
      hookMapbox(val);
    }
  });

  let currentL = window.L;
  Object.defineProperty(window, 'L', {
    configurable: true,
    enumerable: true,
    get: () => currentL,
    set: (val) => {
      currentL = val;
      hookLeaflet(val);
    }
  });
})();
