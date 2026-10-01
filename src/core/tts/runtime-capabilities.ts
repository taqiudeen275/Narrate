interface ClientHints {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean; platform?: string };
}

/** Window has iPad touch information that WorkerNavigator does not expose. */
export function isKokoroMobileHost(client?: ClientHints): boolean {
  return /Android|iPhone|iPad|Mobile/i.test(client?.userAgent ?? '') ||
    /Macintosh|MacIntel/i.test(`${client?.userAgent ?? ''} ${client?.platform ?? ''}`) && (client?.maxTouchPoints ?? 0) > 1 ||
    client?.userAgentData?.mobile === true || /Android|iOS/i.test(client?.userAgentData?.platform ?? '');
}
