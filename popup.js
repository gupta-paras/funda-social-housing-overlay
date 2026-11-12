document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggle-enabled');
  const opacitySlider = document.getElementById('opacity-slider');
  const opacityVal = document.getElementById('opacity-val');
  const minPctSlider = document.getElementById('min-pct-slider');
  const minPctVal = document.getElementById('min-pct-val');
  const colorMode = document.getElementById('color-mode');
  const toggleTooltip = document.getElementById('toggle-tooltip');

  const defaultSettings = {
    enabled: true,
    opacity: 0.65,
    minPercentage: 0,
    colorMode: 'risk',
    showTooltip: true
  };

  chrome.storage.local.get(defaultSettings, (settings) => {
    toggleEnabled.checked = settings.enabled;

    opacitySlider.value = Math.round(settings.opacity * 100);
    opacityVal.textContent = `${opacitySlider.value}%`;

    minPctSlider.value = settings.minPercentage;
    minPctVal.textContent = settings.minPercentage === 0 ? '0% (All)' : `≥ ${settings.minPercentage}%`;

    colorMode.value = settings.colorMode;
    toggleTooltip.checked = settings.showTooltip;
  });

  toggleEnabled.addEventListener('change', () => {
    chrome.storage.local.set({ enabled: toggleEnabled.checked });
  });

  opacitySlider.addEventListener('input', () => {
    opacityVal.textContent = `${opacitySlider.value}%`;
    chrome.storage.local.set({ opacity: parseInt(opacitySlider.value, 10) / 100 });
  });

  minPctSlider.addEventListener('input', () => {
    const v = parseInt(minPctSlider.value, 10);
    minPctVal.textContent = v === 0 ? '0% (All)' : `≥ ${v}%`;
    chrome.storage.local.set({ minPercentage: v });
  });

  colorMode.addEventListener('change', () => {
    chrome.storage.local.set({ colorMode: colorMode.value });
  });

  toggleTooltip.addEventListener('change', () => {
    chrome.storage.local.set({ showTooltip: toggleTooltip.checked });
  });
});
