# Social Housing Overlay (Funda & Google Maps) v1.2.2

A super-performant, lightweight Chrome Extension (Manifest V3) that overlays **AFWC social and corporate housing building blocks** directly onto **Funda** and **Google Maps**, helping you instantly spot and avoid corporate housing areas.

---

## 🚀 Key Features

* **Dual Platform Support:** Runs seamlessly on both **Funda** (`funda.nl/zoeken/kaart/*`) and **Google Maps** (`google.com/maps` / `google.nl/maps`).
* **Instant Motion Disappearance:** As soon as you drag/pan or scroll to zoom, stale polygons disappear immediately (`0ms`), redrawing crisply at the exact new coordinates when movement stops.
* **Proportional Border Transparency:** Both the internal polygon fill and the dark border fade smoothly in tandem with the opacity slider.
* **Instant Visual Alert:** Corporate housing blocks appear highlighted in vivid red (100% corporate) and amber (mixed housing).
* **Super Performant Spatial Grid Index:** Stores 38,293 building blocks in memory and queries visible polygons in **under 2 milliseconds** as you pan and zoom.
* **In-Page Floating HUD Widget:**
  * Clean **ON / OFF** toggle button on the screen.
  * Live counter of corporate blocks currently visible in view.
  * Instant filter: show all, or filter to only blocks with **≥ 50%** or **100%** corporate housing.
* **Interactive Tooltip on Hover:** Hover your mouse over any highlighted building to view:
  * Housing Corporation (e.g. *Eigen Haard, Ymere, Rochdale, De Alliantie, Stadgenoot, GoedeStede*)
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

## 🛠️ How to Install / Reload in Google Chrome

1. Open Google Chrome.
2. Navigate to `chrome://extensions/` in your address bar.
3. Toggle on **Developer mode** in the top-right corner.
4. If already loaded, click the **Reload (🔄) button** on the extension card. (If loading for the first time, click **Load unpacked** and select `C:\repos\housing`).
5. Open any supported map view:
   * **Funda:** [Funda Almere Map](https://www.funda.nl/zoeken/kaart/koop?zoom=17&centerLat=52.3732&centerLng=5.2204&top_left_lat=52.37468451306433&top_left_lng=5.214427603068659&bottom_right_lat=52.37168455579973&bottom_right_lng=5.226400984111139)
   * **Google Maps:** [Google Maps Almere](https://www.google.com/maps/@52.3732,5.2204,17z)
6. Press **`F5`** (or `Ctrl + R`) to refresh the map tab.
