export type LegalPage = {
  path: string;
  eyebrow: string;
  title: string;
  updated: string;
  intro: string;
  sections: Array<{
    title: string;
    paragraphs?: string[];
    bullets?: string[];
  }>;
};

const pages = {
  '/privacy': {
    path: '/privacy',
    eyebrow: 'Privacy',
    title: 'Runcast privacy notice',
    updated: 'August 29, 2026',
    intro:
      'Runcast minimizes the personal data it collects and does not sell personal information or use it for advertising.',
    sections: [
      {
        title: 'Guest use',
        paragraphs: [
          'Runcast works without an account. Guest routes and preferences remain on the device. To produce forecasts and map context, the app sends route-adjacent locations or map viewports directly to Open-Meteo, OpenStreetMap services, and OpenFreeMap. Guest imports keep their on-device OpenStreetMap woodland lookup and are not sent to Runcast or USDA for canopy processing. Those providers receive the network information normally included in an internet request.',
        ],
      },
      {
        title: 'Account data',
        paragraphs: [
          'When you sign in, Runcast stores a provider-neutral account identifier; linked Strava and Apple identifiers; optional name and email; preferences; routes you save to your account; Strava permissions; route watches; recommendation snapshots; device installation metadata; and notification delivery state.',
          'Provider refresh tokens are encrypted at rest. Runcast refresh tokens are stored only as hashes, not as reusable opaque token values.',
        ],
      },
      {
        title: 'Services we use',
        bullets: [
          'Strava for sign-in and, with your authorization, listing and importing running routes.',
          'Apple for optional sign-in or account recovery.',
          'Open-Meteo for route forecasts.',
          'USDA Forest Service Tree Canopy Cover services for numeric canopy evidence along routes explicitly saved to your account.',
          'Expo for optional push-notification delivery.',
          'Render for the API and database hosting.',
          'OpenStreetMap, OpenFreeMap, and MapLibre for route context and maps.',
          'Sentry for minimized crash and app-health diagnostics when configured. Runcast does not send account identity, route names or geometry, request bodies, tokens, screenshots, view hierarchy, or session replay data to Sentry.',
        ],
      },
      {
        title: 'Location and diagnostics',
        paragraphs: [
          'Route geometry can reveal sensitive location patterns. Runcast does not use it for advertising or sell it. For routes explicitly saved to your account, Runcast sends sampled coordinates to USDA and stores the returned canopy profile. Operational logs redact tokens, GPX bodies, coordinates, and push tokens; canopy logs contain only aggregate latency, cache state, completeness, and model deltas.',
          'Crash and session-health diagnostics are kept separate from your Runcast account and are used only to operate and improve the app.',
        ],
      },
      {
        title: 'Your choices',
        paragraphs: [
          'You can disable notification permission in iOS, sign out, remove local routes, or permanently delete your account in the app. Signing out ends the local Runcast session but retains your account and server data. Account deletion attempts to revoke linked Apple and Strava credentials, deletes account-owned records, and clears user-scoped local data. A non-identifying deletion audit event may be retained.',
          'For privacy questions, contact support@runcast.app.',
        ],
      },
    ],
  },
  '/support': {
    path: '/support',
    eyebrow: 'Support',
    title: 'How can we help?',
    updated: 'August 15, 2026',
    intro:
      'Email support@runcast.app and include the app version and approximate time of the problem.',
    sections: [
      {
        title: 'Safe troubleshooting details',
        paragraphs: [
          'If Runcast shows a request or error reference, include it in your message. It helps diagnose a failure without exposing your route.',
        ],
        bullets: [
          'Do not send access tokens, Apple authorization codes, or Strava credentials.',
          'Do not attach GPX files or exact home, work, or other sensitive coordinates.',
          'Do not send notification push tokens.',
        ],
      },
      {
        title: 'Account access',
        paragraphs: [
          'For an urgent account-access concern, sign out in Account & Connections. To permanently remove the account, use Delete account in the same screen or follow the account deletion instructions.',
        ],
      },
    ],
  },
  '/data-deletion': {
    path: '/data-deletion',
    eyebrow: 'Account control',
    title: 'Delete a Runcast account',
    updated: 'August 15, 2026',
    intro:
      'You can permanently delete your Runcast account and its account-owned data from the iOS app.',
    sections: [
      {
        title: 'Delete in the app',
        paragraphs: [
          'Open Account & Connections, choose Account control, select Delete account, and confirm. Runcast attempts to revoke linked Strava and Apple credentials, then deletes identities, preferences, saved routes and forecasts, watches and recommendations, sessions, device installations, and notification delivery records. After server confirmation, the app removes local credentials and user-scoped caches.',
        ],
      },
      {
        title: 'If you cannot use the app',
        paragraphs: [
          'Email support@runcast.app from an address associated with the account. Support will verify ownership without asking for a token, password, authorization code, or GPX file.',
        ],
      },
    ],
  },
  '/forecast-disclaimer': {
    path: '/forecast-disclaimer',
    eyebrow: 'Safety',
    title: 'Forecast disclaimer',
    updated: 'August 29, 2026',
    intro: 'Runcast recommendations are estimates, not guarantees of safe running conditions.',
    sections: [
      {
        title: 'Use your judgment',
        paragraphs: [
          'Recommendations combine third-party forecast data, mapped route geometry, pace assumptions, and a simplified comfort model. Numeric canopy data estimates filtering of direct solar radiation while retaining diffuse radiation; it does not confirm geometric shade from individual trees, buildings, or terrain. Missing canopy data receives no shade reduction. Recommendations do not replace official weather alerts, local guidance, personal judgment, or medical advice.',
          'Conditions can change quickly. Check official warnings and use appropriate visibility and hydration precautions. Do not run when lightning, flooding, extreme heat, poor air quality, ice, unsafe access, or another hazard is present.',
        ],
      },
      {
        title: 'What “best” means',
        paragraphs: [
          'A best start is only the highest-scoring candidate Runcast evaluated within the selected time window. It does not mean the route or conditions are safe.',
        ],
      },
    ],
  },
} satisfies Record<string, LegalPage>;

export const legalNavigation = Object.values(pages);

export function legalPageForPath(pathname: string): LegalPage | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return pages[normalized as keyof typeof pages] ?? null;
}
