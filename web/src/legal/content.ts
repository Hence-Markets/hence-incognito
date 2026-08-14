export const HENCE_LEGAL_BUNDLE = {
  bundleVersion: 'hence-legal-v1',
  termsVersion: '2026-04-09',
  privacyVersion: '2026-04-09',
  cookieVersion: '2026-04-09',
} as const;

export const HENCE_LEGAL_LINKS = {
  terms: '/legal/terms',
  privacy: '/legal/privacy',
  cookies: '/legal/cookies',
} as const;

export type HenceLegalDocumentKey = keyof typeof HENCE_LEGAL_LINKS;

type LegalSection = {
  heading: string;
  body: string[];
};

export type HenceLegalDocument = {
  key: HenceLegalDocumentKey;
  title: string;
  subtitle: string;
  version: string;
  lastUpdated: string;
  sections: LegalSection[];
};

export const HENCE_LEGAL_DOCUMENTS: Record<HenceLegalDocumentKey, HenceLegalDocument> = {
  terms: {
    key: 'terms',
    title: 'Hence Terms of Use',
    subtitle: 'Rules for accessing Hence, connecting a wallet, and using Hence to discover and route trades.',
    version: HENCE_LEGAL_BUNDLE.termsVersion,
    lastUpdated: 'April 9, 2026',
    sections: [
      {
        heading: 'Using Hence',
        body: [
          'Hence provides market discovery, research, strategy tooling, and execution routing across supported venues. Hence does not guarantee that markets, routing, or third-party APIs will always be available, accurate, or uninterrupted.',
          'You are responsible for reviewing any order, signature, approval, or automated action before you authorize it. If you do not understand a prompt or a trade, do not approve it.',
        ],
      },
      {
        heading: 'Wallets and signatures',
        body: [
          'Connecting a wallet to Hence is gas-free, but it may involve signed messages that prove wallet ownership, confirm acceptance of these policies, or authorize venue-specific trading setup such as a Hyperliquid trading agent.',
          'These signatures are distinct from onchain token approvals unless the interface clearly says otherwise. Hence will tell you when an action is only a signature versus a transaction that may cost gas.',
        ],
      },
      {
        heading: 'Trading risks',
        body: [
          'Prediction markets, spot trading, and perpetual trading involve risk, including total loss of capital. Market data, settlement outcomes, liquidity conditions, spreads, and third-party venue behavior can change quickly.',
          'Hence is not providing investment, legal, accounting, or tax advice. You are solely responsible for the decisions you make through the product.',
        ],
      },
      {
        heading: 'Acceptable use',
        body: [
          'You may not use Hence to violate law, abuse third-party services, evade venue rules, interfere with other users, or attempt unauthorized access to wallets, accounts, APIs, or infrastructure.',
          'We may limit or suspend access to protect users, comply with legal obligations, or respond to abuse, security incidents, or service instability.',
        ],
      },
    ],
  },
  privacy: {
    key: 'privacy',
    title: 'Hence Privacy Policy',
    subtitle: 'How Hence handles wallet-linked product data, diagnostics, and support information.',
    version: HENCE_LEGAL_BUNDLE.privacyVersion,
    lastUpdated: 'April 9, 2026',
    sections: [
      {
        heading: 'Information we process',
        body: [
          'Hence may process wallet addresses, connected chain information, saved preferences, agent-wallet status, execution history, watchlists, alerts, and support or diagnostic data associated with your use of the app.',
          'When you use supported venue integrations, Hence may also process the data needed to route, confirm, or display those venue actions, including approval status and order results.',
        ],
      },
      {
        heading: 'How we use data',
        body: [
          'We use this data to operate the product, verify wallet-linked onboarding steps, render portfolio and trading views, improve reliability, investigate incidents, and respond to support requests.',
          'We may also use aggregated or de-identified usage data to understand product performance and prioritize improvements.',
        ],
      },
      {
        heading: 'Storage and retention',
        body: [
          'Some product state is stored locally in your browser so the app can remain usable between visits. Other records, such as onboarding acceptance history or venue-approval state, may be stored on Hence servers when required to operate the product.',
          'We retain data only as long as reasonably necessary for product operations, security, legal compliance, and auditability.',
        ],
      },
      {
        heading: 'Third-party services',
        body: [
          'Hence relies on external infrastructure and venue APIs. Those providers may receive the requests necessary to serve markets, balances, signatures, approvals, analytics, or execution responses.',
          'Using Hence does not change the privacy practices of those third-party services. Please review the policies of the trading venues and infrastructure providers you use.',
        ],
      },
    ],
  },
  cookies: {
    key: 'cookies',
    title: 'Hence Cookie and Telemetry Policy',
    subtitle: 'How Hence uses browser storage, session state, and analytics after you accept this legal bundle.',
    version: HENCE_LEGAL_BUNDLE.cookieVersion,
    lastUpdated: 'April 9, 2026',
    sections: [
      {
        heading: 'Essential product storage',
        body: [
          'Hence uses browser storage and cookie-like mechanisms that are necessary for core functionality, including session continuity, wallet-onboarding state, UI preferences, and reliability features.',
          'Without this essential storage, parts of the app may not work correctly or may require you to repeat setup more often.',
        ],
      },
      {
        heading: 'Analytics and telemetry',
        body: [
          'After you accept this legal bundle for the connected wallet, Hence may enable product analytics and telemetry tools, including PostHog, to measure feature usage, understand app performance, and diagnose failures.',
          'These tools help us improve the app, but they are only activated after your current wallet has accepted the current Hence legal bundle on this device.',
        ],
      },
      {
        heading: 'What is collected',
        body: [
          'Telemetry may include page views, product interactions, client diagnostics, and coarse wallet-linked product usage data that help us understand whether onboarding, trading, and support flows are working.',
          'Hence does not use this policy flow to request token spending approvals. It only governs storage, analytics, and the product signatures required to operate the app.',
        ],
      },
      {
        heading: 'Managing consent',
        body: [
          'Because the product currently uses a single mandatory acceptance model, continued use of the connected-wallet experience in `/app` requires agreement to this cookie and telemetry policy together with the Terms of Use and Privacy Policy.',
          'If you do not agree, you can decline the onboarding flow and disconnect your wallet. Public landing pages remain browseable without wallet onboarding.',
        ],
      },
    ],
  },
};
