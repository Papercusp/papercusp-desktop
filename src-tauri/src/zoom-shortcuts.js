// Native page zoom for every desktop webview, independent of the SPA lifecycle.
// Tauri's built-in zoom hotkeys only work on Windows. Use its existing setZoom
// IPC on all platforms so layout, fixed overlays and devicePixelRatio scale too.
;(() => {
  const isMac = __PAPERCUSP_ZOOM_MACOS__;
  const levels = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  const storageKey = 'papercusp.desktop.zoom';
  let zoom = 1;
  let appliedZoom = 1;
  let pending = Promise.resolve();

  try {
    const saved = Number(window.localStorage.getItem(storageKey));
    if (levels.includes(saved)) zoom = saved;
  } catch {
    // Zoom still works when the webview cannot access persistent storage.
  }

  function applyZoom(value) {
    // Serialize native calls so rapid presses cannot apply an older level last.
    pending = pending.then(async () => {
      await window.__TAURI_INTERNALS__.invoke('plugin:webview|set_webview_zoom', {
        label: window.__TAURI_INTERNALS__.metadata.currentWebview.label,
        value,
      });
      appliedZoom = value;
      try {
        window.localStorage.setItem(storageKey, String(value));
      } catch {
        // The native operation succeeded; persistence is optional.
      }
    }).catch((error) => {
      if (zoom === value) zoom = appliedZoom;
      console.warn('[desktop zoom] Could not apply page zoom', error);
    });
  }

  window.addEventListener('keydown', (event) => {
    if (event.isComposing || event.altKey) return;
    const modifier = isMac
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
    if (!modifier) return;

    let next;
    if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') {
      next = levels.find((level) => level > zoom) ?? levels[levels.length - 1];
    } else if (event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract') {
      next = levels.findLast((level) => level < zoom) ?? levels[0];
    } else if (event.key === '0') {
      next = 1;
    } else {
      return;
    }

    // Capture browser-level shortcuts even when an editor or input has focus.
    event.preventDefault();
    event.stopImmediatePropagation();
    zoom = next;
    applyZoom(next);
  }, true);

  // Tauri installs currentWebview metadata after this initialization script.
  // Restore after initialization on reload/navigation, including a reset to 100%.
  window.addEventListener('DOMContentLoaded', () => applyZoom(zoom), { once: true });
})();
