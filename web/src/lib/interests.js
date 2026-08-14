// The interest taxonomy shown during onboarding. Each item is {topic, label} under a
// {kind} group. Selections are saved to the user's account (/api/me/interests) and become
// the filtering substrate that personalizes the home feed + signals ranking.
//
// kinds: asset_class | sector | theme | source. The 'source' slugs intentionally match our
// signal sources/voices so "follow Arthur Hayes" directly boosts his calls in your feed.

export const INTEREST_GROUPS = [
  {
    kind: 'asset_class', title: 'What do you trade?',
    sub: 'Pick the markets you actually follow.',
    items: [
      { topic: 'crypto', label: 'Crypto', emoji: '₿' },
      { topic: 'stocks', label: 'Stocks', emoji: '📈' },
      { topic: 'perps', label: 'Perps / leverage', emoji: '⚡' },
      { topic: 'predictions', label: 'Prediction markets', emoji: '🎲' },
      { topic: 'fx', label: 'FX', emoji: '💱' },
      { topic: 'commodities', label: 'Commodities', emoji: '🛢️' },
    ],
  },
  {
    kind: 'sector', title: 'Crypto sectors',
    items: [
      { topic: 'defi', label: 'DeFi' }, { topic: 'ai-agents', label: 'AI agents' },
      { topic: 'memecoins', label: 'Memecoins' }, { topic: 'l1-l2', label: 'L1s & L2s' },
      { topic: 'rwa', label: 'RWAs' }, { topic: 'depin', label: 'DePIN' },
      { topic: 'gaming', label: 'Gaming' }, { topic: 'infrastructure', label: 'Infrastructure' },
    ],
  },
  {
    kind: 'sector', title: 'Stock sectors',
    items: [
      { topic: 'tech', label: 'Tech' }, { topic: 'semis', label: 'Semiconductors' },
      { topic: 'energy', label: 'Energy' }, { topic: 'healthcare', label: 'Healthcare' },
      { topic: 'financials', label: 'Financials' }, { topic: 'consumer', label: 'Consumer' },
    ],
  },
  {
    kind: 'theme', title: 'Themes you care about',
    items: [
      { topic: 'macro', label: 'Macro' }, { topic: 'etf-flows', label: 'ETF & institutional flows' },
      { topic: 'onchain-yield', label: 'On-chain yield' }, { topic: 'new-launches', label: 'New launches' },
      { topic: 'earnings', label: 'Earnings plays' }, { topic: 'catalysts', label: 'Catalysts & events' },
    ],
  },
  {
    kind: 'source', title: 'Voices to follow',
    sub: 'Podcasts & newsletters whose calls we track over time.',
    items: [
      { topic: 'arthur-hayes', label: 'Arthur Hayes' }, { topic: 'ignas', label: 'Ignas' },
      { topic: 'the-defi-investor', label: 'The DeFi Investor' }, { topic: 'the-defi-edge', label: 'The DeFi Edge' },
      { topic: 'phyrex', label: 'Phyrex' }, { topic: 'empire', label: 'Empire' },
      { topic: 'bankless', label: 'Bankless' }, { topic: 'forward-guidance', label: 'Forward Guidance' },
    ],
  },
];

// key helpers for the picker's selection Set
export const keyOf = (kind, topic) => `${kind}:${topic}`;
export const parseKey = (k) => { const i = k.indexOf(':'); return { kind: k.slice(0, i), topic: k.slice(i + 1) }; };
