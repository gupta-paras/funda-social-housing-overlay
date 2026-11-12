# Funda Social Housing Overlay (Chrome Extension)

A super-performant, lightweight Chrome Extension (Manifest V3) that overlays **social and corporate housing building blocks** directly onto **Funda's interactive map**, helping you instantly spot and avoid corporate housing areas when house hunting.

---

## 🚀 Key Features

* **Instant Visual Alert on Funda:** Corporate housing blocks appear as highlighted overlays (vivid red for 100% corporate housing, amber for mixed blocks).
* **Super Performant Spatial Grid Index:** Keeps 38,293 building blocks in memory and queries visible polygons in **under 2 milliseconds** as you pan and zoom.
* **Dual-Engine Synchronization:** 
  * Hooks into Funda's map engine for real-time viewport tracking.
  * Continuously syncs with Funda's bounding box coordinates (`top_left_lat`, `bottom_right_lat`, etc.).
* **In-Page Floating HUD Widget:**
  * Quick **ON / OFF** switch directly on the map.
  * Live counter of corporate housing blocks currently visible on screen.
  * Instant filter: show all, or filter to only blocks with **≥ 50%** or **100%** social housing.
* **Interactive Tooltip on Hover:** Hover your mouse over any highlighted building to view:
  * Housing Corporation (e.g. *Eigen Haard, Ymere, Rochdale, De Alliantie, Stadgenoot*)
  * Social Housing % (e.g. *100% Social Housing*)
  * Total units vs corporate units in the block
* **Customization Popup:**
  * Adjust layer opacity (10% to 100%).
  * Switch between **Risk Alert Red** and official **AFWC Corporation Brand Colors**.

---

## 📦 Dataset & Coverage

* **Source:** [AFWC 2025 (Amsterdamse Federatie van Woningcorporaties)](https://maps.amsterdam.nl/afwc_2025/)
* **Volume:** **38,293 building blocks** (~400,000 corporate dwellings).
* **Covered Municipalities:** Amsterdam, Almere, Amstelveen, Haarlem, Haarlemmermeer, Hilversum, Purmerend, Zaanstad, Lelystad, Gooise Meren, Huizen, Beverwijk, and the rest of the Metropoolregio Amsterdam (MRA).

---

## 🛠️ How to Install in Google Chrome

1. Open Google Chrome.
2. Navigate to `chrome://extensions/` in your address bar.
3. Toggle on **Developer mode** in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select this folder: `C:\repos\housing`.
6. That's it! The extension is now installed.

---

## 🔍 How to Use on Funda

1. Open Funda's map view, for example:
   [Funda Kaartweergave Amsterdam](https://www.funda.nl/zoeken/kaart/koop?zoom=14&centerLat=52.3676&centerLng=4.9041)
2. You will immediately see:
   * The floating **"🏘️ Social Housing"** widget in the upper-right corner of the map.
   * Red and orange patches covering social housing building blocks.
3. As you zoom in or pan across streets, the visible patches update seamlessly at 60 FPS.
4. Hover over any colored building block to see the corporation name and exact social percentage.
