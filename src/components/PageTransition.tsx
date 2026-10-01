import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { prefersReducedMotion } from '../core/motion';

/** Keep navigation responsive: animate the new view, cancel on the next move. */
export function PageTransition({ viewKey, position, children }: { viewKey: string; position: number; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  const previous = useRef({ viewKey, position });
  const animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { viewKey, position };
    if (before.viewKey === viewKey) return;
    animation.current?.cancel();
    if (!prefersReducedMotion() && element.current?.animate) {
      const direction = position < before.position ? -1 : 1;
      animation.current = element.current.animate([
        { opacity: 0.45, transform: `translateX(${direction * 18}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ], { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
  }, [viewKey, position]);
  useLayoutEffect(() => () => { animation.current?.cancel(); }, []);
  return <div className="n-view-transition" ref={element}>{children}</div>;
}
