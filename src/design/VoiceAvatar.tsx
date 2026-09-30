import type { Voice } from '../core/tts/voices';

/**
 * A voice's avatar.
 *
 * The reference puts a small circular portrait in the header, so the avatar is
 * a disc: a soft tinted ground carrying the narrator's initial, with a ring that
 * lights when the voice is the one currently speaking.
 *
 * Generated rather than photographed. A product whose first principle is that
 * nothing leaves the machine has no business loading stock faces, and a
 * consistent set of tinted discs reads as a cast of people far better than a
 * grab-bag of unrelated headshots would.
 */
export function VoiceAvatar({
  voice,
  size = 40,
  active,
}: {
  voice: Voice;
  size?: number;
  active?: boolean;
}) {
  const initial = voice.name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className={`n-avatar${active ? ' n-avatar-active' : ''}`}
      style={{
        inlineSize: size,
        blockSize: size,
        fontSize: Math.max(11, Math.round(size * 0.4)),
        '--av-h': String(voice.tone),
      } as React.CSSProperties}
      title={voice.name}
      aria-hidden="true"
    >
      <span className="n-avatar-initial">{initial}</span>
    </span>
  );
}
