/* Curated profiles for venue-listed equities that FMP cannot see.

   trade.xyz lists names FMP doesn't index — Shanghai/STAR listings and Chinese AI labs.
   For those, every FMP call returns [], so the asset page fell back to corporate
   boilerplate ("designs, manufactures and sells its products") and a generic right card.
   These entries feed the SAME fill paths a real FMP profile feeds (About swap, fact rows),
   so a curated name renders indistinguishably from a covered one — minus the sections that
   genuinely need financial statements, which stay hidden (the existing FMP-dark handling).

   Rules for this map:
   - Facts only, written to age well: what the company IS, where it sits, who founded it.
     No prices, no market caps, no listing-status claims we can't verify via FMP.
   - Foreign-currency FMP listings (e.g. GigaDevice 603986.SS) are deliberately NOT aliased
     into EQUITY_FMP_ALIAS: their statements report in CNY/KRW and would render as USD.
     ADR aliases (HYMTF/SFTBY/SSNLF/SKHY) stay the pattern for real data; curated text
     covers the rest. */

export type CuratedEquity = {
  name: string;
  sector: string;
  hq: string;
  website: string;
  description: string;
  ceo?: string;
};

export const CURATED_EQUITY: Record<string, CuratedEquity> = {
  UNITREE: {
    name: 'Unitree Robotics',
    sector: 'Robotics',
    hq: 'Hangzhou, China',
    website: 'https://www.unitree.com',
    ceo: 'Wang Xingxing',
    description:
      'Unitree Robotics is a Hangzhou-based robotics company best known for its quadruped robot ' +
      'dogs (the Go and B series) and its G1 and H1 humanoid robots, alongside robotic arms and ' +
      'lidar sensors. Founded in 2016 by Wang Xingxing, it has become one of the most prominent ' +
      'names in the push toward mass-market legged robotics.',
  },
  CXMT: {
    name: 'ChangXin Memory',
    sector: 'Semiconductors — Memory',
    hq: 'Hefei, China',
    website: 'https://www.cxmt.com',
    description:
      'ChangXin Memory Technologies (CXMT) is China’s leading DRAM manufacturer, ' +
      'headquartered in Hefei. It is the country’s primary domestic challenger to Samsung, ' +
      'SK hynix and Micron in memory chips, and a centerpiece of China’s drive for ' +
      'semiconductor self-sufficiency.',
  },
  MINIMAX: {
    name: 'MiniMax',
    sector: 'Artificial Intelligence',
    hq: 'Shanghai, China',
    website: 'https://www.minimaxi.com',
    description:
      'MiniMax is a Shanghai-based AI lab behind the MiniMax family of foundation models and ' +
      'consumer AI apps including Talkie and Hailuo. It is one of China’s leading ' +
      'large-model startups, spanning text, voice and video generation.',
  },
  ZHIPU: {
    name: 'Zhipu AI',
    sector: 'Artificial Intelligence',
    hq: 'Beijing, China',
    website: 'https://www.z.ai',
    description:
      'Zhipu AI is a Beijing-based AI company spun out of Tsinghua University, developer of the ' +
      'GLM family of foundation models and the ChatGLM assistant. It is among the leading ' +
      'startups in China’s foundation-model race.',
  },
  GIGADEV: {
    name: 'GigaDevice',
    sector: 'Semiconductors',
    hq: 'Beijing, China',
    website: 'https://www.gigadevice.com',
    description:
      'GigaDevice Semiconductor is a Beijing-based, Shanghai-listed chip designer specializing ' +
      'in NOR flash memory, microcontrollers and sensor chips — a key supplier to the ' +
      'consumer-electronics and automotive industries.',
  },
};
