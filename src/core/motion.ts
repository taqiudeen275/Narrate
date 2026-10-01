export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
    typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion === 'true';
}
