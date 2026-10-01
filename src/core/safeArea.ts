declare global {
  interface Window { NarrateInsets?: { read(): string } }
}

/** Older Android WebViews need this before React; browsers use CSS env(). */
export function syncNativeInsets() {
  try {
    const bridge = window.NarrateInsets;
    if (!bridge) return;
    const { safeArea, reduceMotion } = JSON.parse(bridge.read());
    const root = document.documentElement;
    if (safeArea) for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const value = safeArea[side];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) root.style.setProperty(`--native-safe-area-${side}`, `${value}px`);
    }
    root.dataset.reduceMotion = String(reduceMotion === true);
  } catch { /* Keep the browser's safe-area fallback if the bridge is unavailable. */ }
}
