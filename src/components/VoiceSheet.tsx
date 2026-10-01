import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useNarrate } from '../state/store';
import { VoiceAvatar } from '../design/VoiceAvatar';
import { Icon } from '../design/Icon';
import { availableVoices } from '../core/tts/voices';
import { useAudition } from './useAudition';
import { prefersReducedMotion } from '../core/motion';

/**
 * Narrator picker, as a sheet over the current screen.
 *
 * Reached from the Listen and Read views so the narrator can be changed without
 * leaving the thing you were listening to. Voices come from
 * `availableVoices()`, which is the engine's own list — narrators are speakers
 * inside one model's weights, so the catalogue is model-bound, not global.
 */
export function VoiceSheet({ onClose }: { onClose: () => void }) {
  const { voiceId, setVoice, engine, engineReady, ensureEngine, busy } = useNarrate(useShallow(state => ({
    voiceId: state.voiceId, setVoice: state.setVoice, engine: state.engine, engineReady: state.engineReady,
    ensureEngine: state.ensureEngine, busy: state.busy,
  })));
  const [query, setQuery] = useState('');
  const { audition, error } = useAudition(engine, ensureEngine);
  const [closing, setClosing] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const exitTimer = useRef<number | null>(null);
  const closingRequested = useRef(false);
  const closed = useRef(false);
  const closeCallback = useRef(onClose);

  useLayoutEffect(() => {
    closeCallback.current = onClose;
  }, [onClose]);

  const finishClose = useCallback(() => {
    if (!closingRequested.current || closed.current) return;
    closed.current = true;
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
    closeCallback.current();
  }, []);

  const requestClose = useCallback(() => {
    if (closingRequested.current) return;
    closingRequested.current = true;
    setClosing(true);
  }, []);

  useLayoutEffect(() => {
    const element = sheet.current;
    if (!element) return;
    const currentTransform = closing ? window.getComputedStyle?.(element).transform : undefined;
    animation.current?.cancel();
    if (prefersReducedMotion()) {
      element.dataset.motion = 'none';
      if (closing) finishClose();
      return;
    }

    const offset = window.matchMedia?.('(max-width: 640px)').matches ? '100%' : '1.5rem';
    const duration = closing ? 180 : 320;
    element.dataset.motion = 'css';
    if (element.animate) {
      try {
        element.dataset.motion = 'waapi';
        animation.current = element.animate(closing ? [
          { transform: currentTransform && currentTransform !== 'none' ? currentTransform : 'translateY(0)' },
          { transform: `translateY(${offset})` },
        ] : [
          { transform: `translateY(${offset})` },
          { transform: 'translateY(0)' },
        ], { duration, easing: closing ? 'cubic-bezier(0.4, 0, 1, 1)' : 'cubic-bezier(0.16, 1, 0.3, 1)' });
        if (closing) void animation.current.finished.then(finishClose, () => {});
      } catch {
        // Older WebViews can expose an incomplete animate implementation.
        element.dataset.motion = 'css';
      }
    }
    // CSS animation events and WAAPI promises can be lost when a WebView is
    // backgrounded. Dismissal must still finish and release modal protection.
    if (closing) exitTimer.current = window.setTimeout(finishClose, duration + 50);
  }, [closing, finishClose]);

  useLayoutEffect(() => {
    const element = sheet.current;
    if (!element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Move focus before hiding the opener's ancestors from accessibility APIs.
    // Focus Close rather than Search so opening a sheet never opens the IME.
    element.querySelector<HTMLElement>('[aria-label="Close"]')?.focus();
    const background = Array.from(document.body.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement && child !== scrim.current && !['SCRIPT', 'STYLE', 'LINK'].includes(child.tagName))
      .map(child => ({ child, inert: child.getAttribute('inert'), hidden: child.getAttribute('aria-hidden') }));
    for (const { child } of background) {
      child.setAttribute('inert', '');
      child.setAttribute('aria-hidden', 'true');
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      } else if (event.key === 'Tab') {
        const controls = Array.from(element.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]'));
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !element.contains(document.activeElement)) {
          event.preventDefault();
          (first ?? element).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const keepFocus = (event: FocusEvent) => {
      if (!element.contains(event.target as Node)) element.focus();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', keepFocus, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', keepFocus, true);
      animation.current?.cancel();
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
      for (const { child, inert, hidden } of background) {
        if (inert === null) child.removeAttribute('inert'); else child.setAttribute('inert', inert);
        if (hidden === null) child.removeAttribute('aria-hidden'); else child.setAttribute('aria-hidden', hidden);
      }
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [requestClose]);

  const voices = availableVoices();
  const q = query.trim().toLowerCase();
  const list = voices.filter(
    (v) => !q || v.name.toLowerCase().includes(q) || v.persona.toLowerCase().includes(q),
  );

  return createPortal(
    <div className="n-sheet-scrim" ref={scrim} onClick={requestClose} role="presentation">
      <div className="n-sheet-backdrop" aria-hidden="true" />
      <div
        className="n-sheet"
        ref={sheet}
        data-closing={closing}
        role="dialog"
        aria-modal="true"
        aria-label="Choose a narrator"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && event.animationName === 'n-sheet-leave') finishClose();
        }}
      >
        <header className="n-sheet-head">
          <div>
            <div className="label">Casting</div>
            <h2 className="n-sheet-title">Choose a narrator</h2>
            <p className="n-sheet-sub">
              {voices.length} Kokoro narrators, shared by Balanced, Full precision
              and the 4-bit edition. Choose the voice you want to hear.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={requestClose} disabled={closing} aria-label="Close">
            <Icon name="close" size={17} />
          </button>
        </header>

        <div className="n-sheet-search n-searchwrap">
          <Icon name="search" size={17} />
          <input
            className="input"
            placeholder="Search narrators"
            value={query}
            disabled={closing}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search narrators"
          />
        </div>

        {error ? <p className="n-error" role="alert">{error}</p> : null}

        <div className="n-sheet-list scroll">
          {list.map((v) => {
            const on = v.id === voiceId;
            return (
              <div key={v.id} className={`n-sheet-row${on ? ' n-sheet-row-on' : ''}`}>
                <button
                  type="button"
                  className="n-sheet-pick"
                  onClick={() => { setVoice(v.id); requestClose(); }}
                  disabled={closing}
                  aria-pressed={on}
                >
                  <VoiceAvatar voice={v} size={40} active={on} />
                  <span className="n-sheet-text">
                    <span className="n-sheet-name">{v.name}</span>
                    <span className="n-sheet-voice-meta">
                      {v.gender ? <span className="n-voice-gender">{v.gender}</span> : null}
                      <span>{v.accent}</span>
                    </span>
                    <span className="n-sheet-persona">{v.persona}</span>
                  </span>
                  {on ? <span className="n-sheet-check"><Icon name="check" size={15} /></span> : null}
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  onClick={() => void audition(v.sample, v.id)}
                  disabled={busy || closing}
                  aria-label={`Audition ${v.name}`}
                  title={engineReady ? 'Audition' : 'Load the model to audition'}
                >
                  <Icon name="play" size={13} />
                </button>
              </div>
            );
          })}
          {list.length === 0 ? <p className="n-empty-body">No narrator matches “{query}”.</p> : null}
        </div>

        <footer className="n-sheet-foot">
          <span className="n-sheet-note">
            Automatic scores do not pick a narrator. They over-rate small models with
            cheap vocoders — listen and decide for yourself.
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
