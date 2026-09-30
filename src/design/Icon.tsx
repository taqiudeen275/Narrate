/**
 * Icons.
 *
 * Stroke-based line glyphs on a 24-unit grid, round caps and joins, drawn at
 * whatever size the control asks for. They are the reference's visual
 * vocabulary, so they sit inside the circular buttons rather than replacing
 * them.
 */

import type { ReactElement } from 'react';

export type IconName =
  | 'play' | 'pause' | 'stop'
  | 'prevSentence' | 'nextSentence'
  | 'prevParagraph' | 'nextParagraph'
  | 'page' | 'focus' | 'voice' | 'models' | 'library'
  | 'mic' | 'download' | 'search' | 'check' | 'close' | 'settings' | 'bell' | 'file';

const PATHS: Record<IconName, ReactElement> = {
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="8" y="5.5" width="2.6" height="13" rx="1.3" fill="currentColor" stroke="none" />
      <rect x="13.4" y="5.5" width="2.6" height="13" rx="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="2.4" fill="currentColor" stroke="none" />,
  /* Sentence jumps are a single chevron. Paragraph jumps carry a bar on the
     outside edge, following the skip-to-start convention: a bar means "jump",
     a bare chevron means "step". */
  prevSentence: <path d="M16 18.5 9.5 12 16 5.5" />,
  nextSentence: <path d="M8 5.5 14.5 12 8 18.5" />,
  prevParagraph: (
    <>
      <path d="M4.5 4.5v15" />
      <path d="M17.5 18.5 10.5 12l7-6.5" />
    </>
  ),
  nextParagraph: (
    <>
      <path d="M19.5 4.5v15" />
      <path d="M6.5 5.5 13.5 12l-7 6.5" />
    </>
  ),
  page: (
    <>
      <path d="M6 3.5h8.5L19 8v12.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V8h4.5" />
    </>
  ),
  focus: (
    <>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
      <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </>
  ),
  voice: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </>
  ),
  models: (
    <>
      <path d="M12 3.5 20 8v8l-8 4.5L4 16V8z" />
      <path d="M12 12 20 8" />
      <path d="M12 12v8.5" />
      <path d="M12 12 4 8" />
    </>
  ),
  library: (
    <>
      <rect x="3.5" y="4.5" width="5" height="15" rx="1.4" />
      <rect x="10" y="4.5" width="4.5" height="15" rx="1.4" />
      <path d="m16.6 5.6 3.4 14" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 4.5 4.5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.9 1.9M7.2 16.8l-1.9 1.9M18.7 18.7l-1.9-1.9M7.2 7.2 5.3 5.3" />
    </>
  ),
  bell: (
    <>
      <path d="M18 16.5V11a6 6 0 0 0-12 0v5.5L4.5 19h15z" />
      <path d="M10 21.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  file: (
    <>
      <path d="M6 3.5h8.5L19 8v12.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M8.5 12.5h7M8.5 16h5" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.7,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
