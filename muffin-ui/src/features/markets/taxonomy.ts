/**
 * Client-side market taxonomy + SAMPLE performance numbers.
 *
 * muffin-agent has no region/country/sector taxonomy and no structured
 * best/worst endpoint, so the drill-down navigation is driven by this authored
 * dataset. All `changePct` values are illustrative SAMPLE data (clearly badged
 * in the UI) — real market data is a later milestone. Sector slugs match
 * muffin-agent's skill tags / criteria_analysis classification where possible.
 */

export type Market = 'developed' | 'emerging';

export interface Region {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  changePct: number;
}

export interface Country {
  id: string;
  name: string;
  regionId: string;
  flag: string;
  market: Market;
  changePct: number;
}

export interface Sector {
  id: string;
  name: string;
  emoji: string;
  subSectors: string[];
  changePct: number;
}

export interface StockRef {
  ticker: string;
  name: string;
  country: string;
  changePct: number;
}

export const REGIONS: Region[] = [
  { id: 'north-america', name: 'North America', emoji: '🌎', blurb: 'Deep, liquid developed markets led by US mega-caps.', changePct: 11.4 },
  { id: 'europe', name: 'Europe', emoji: '🌍', blurb: 'Diversified developed markets, value & industrials tilt.', changePct: 6.1 },
  { id: 'asia-pacific', name: 'Asia-Pacific', emoji: '🌏', blurb: 'Japan, Australia and fast-growing emerging Asia.', changePct: 8.7 },
  { id: 'greater-china', name: 'Greater China', emoji: '🐉', blurb: 'China, Hong Kong and Taiwan — policy-sensitive.', changePct: -3.2 },
  { id: 'latin-america', name: 'Latin America', emoji: '🌴', blurb: 'Commodity-rich emerging markets, higher beta.', changePct: 4.5 },
  { id: 'mea', name: 'Middle East & Africa', emoji: '🕌', blurb: 'Energy exporters and frontier growth stories.', changePct: 2.3 },
];

export const COUNTRIES: Country[] = [
  // North America
  { id: 'united-states', name: 'United States', regionId: 'north-america', flag: '🇺🇸', market: 'developed', changePct: 12.6 },
  { id: 'canada', name: 'Canada', regionId: 'north-america', flag: '🇨🇦', market: 'developed', changePct: 7.0 },
  { id: 'mexico', name: 'Mexico', regionId: 'north-america', flag: '🇲🇽', market: 'emerging', changePct: 5.4 },
  // Europe
  { id: 'united-kingdom', name: 'United Kingdom', regionId: 'europe', flag: '🇬🇧', market: 'developed', changePct: 5.2 },
  { id: 'germany', name: 'Germany', regionId: 'europe', flag: '🇩🇪', market: 'developed', changePct: 7.8 },
  { id: 'france', name: 'France', regionId: 'europe', flag: '🇫🇷', market: 'developed', changePct: 4.1 },
  { id: 'switzerland', name: 'Switzerland', regionId: 'europe', flag: '🇨🇭', market: 'developed', changePct: 6.6 },
  // Asia-Pacific
  { id: 'japan', name: 'Japan', regionId: 'asia-pacific', flag: '🇯🇵', market: 'developed', changePct: 14.2 },
  { id: 'australia', name: 'Australia', regionId: 'asia-pacific', flag: '🇦🇺', market: 'developed', changePct: 6.9 },
  { id: 'india', name: 'India', regionId: 'asia-pacific', flag: '🇮🇳', market: 'emerging', changePct: 13.1 },
  { id: 'south-korea', name: 'South Korea', regionId: 'asia-pacific', flag: '🇰🇷', market: 'emerging', changePct: 3.4 },
  // Greater China
  { id: 'china', name: 'China', regionId: 'greater-china', flag: '🇨🇳', market: 'emerging', changePct: -5.1 },
  { id: 'hong-kong', name: 'Hong Kong', regionId: 'greater-china', flag: '🇭🇰', market: 'developed', changePct: -1.8 },
  { id: 'taiwan', name: 'Taiwan', regionId: 'greater-china', flag: '🇹🇼', market: 'emerging', changePct: 9.3 },
  // Latin America
  { id: 'brazil', name: 'Brazil', regionId: 'latin-america', flag: '🇧🇷', market: 'emerging', changePct: 6.2 },
  { id: 'chile', name: 'Chile', regionId: 'latin-america', flag: '🇨🇱', market: 'emerging', changePct: 2.7 },
  // Middle East & Africa
  { id: 'saudi-arabia', name: 'Saudi Arabia', regionId: 'mea', flag: '🇸🇦', market: 'emerging', changePct: 3.8 },
  { id: 'south-africa', name: 'South Africa', regionId: 'mea', flag: '🇿🇦', market: 'emerging', changePct: 1.1 },
  { id: 'united-arab-emirates', name: 'United Arab Emirates', regionId: 'mea', flag: '🇦🇪', market: 'emerging', changePct: 4.6 },
];

export const SECTORS: Sector[] = [
  { id: 'information-technology', name: 'Information Technology', emoji: '💻', subSectors: ['software-saas', 'semiconductors', 'hardware'], changePct: 18.9 },
  { id: 'financials', name: 'Financials', emoji: '🏦', subSectors: ['banking', 'insurance', 'capital-markets'], changePct: 9.4 },
  { id: 'health-care', name: 'Health Care', emoji: '🏥', subSectors: ['pharma', 'biotech', 'medical-devices'], changePct: 3.6 },
  { id: 'consumer-discretionary', name: 'Consumer Discretionary', emoji: '🛍️', subSectors: ['retail', 'autos', 'travel-leisure'], changePct: 7.2 },
  { id: 'consumer-staples', name: 'Consumer Staples', emoji: '🧺', subSectors: ['food-beverage', 'household-products'], changePct: 2.1 },
  { id: 'communication-services', name: 'Communication Services', emoji: '📡', subSectors: ['media', 'telecom', 'interactive-media'], changePct: 10.8 },
  { id: 'industrials', name: 'Industrials', emoji: '🏭', subSectors: ['aerospace-defense', 'machinery', 'transportation'], changePct: 6.4 },
  { id: 'energy', name: 'Energy', emoji: '⛽', subSectors: ['oil-gas', 'renewables'], changePct: -2.5 },
  { id: 'materials', name: 'Materials', emoji: '⛏️', subSectors: ['chemicals', 'metals-mining'], changePct: 1.9 },
  { id: 'utilities', name: 'Utilities', emoji: '💡', subSectors: ['electric', 'water'], changePct: 4.0 },
  { id: 'real-estate', name: 'Real Estate', emoji: '🏢', subSectors: ['reits', 'real-estate-management'], changePct: -0.8 },
];

export const REPRESENTATIVE_TICKERS: Record<string, StockRef[]> = {
  'information-technology': [
    { ticker: 'AAPL', name: 'Apple', country: 'United States', changePct: 14.1 },
    { ticker: 'MSFT', name: 'Microsoft', country: 'United States', changePct: 16.7 },
    { ticker: 'NVDA', name: 'NVIDIA', country: 'United States', changePct: 41.3 },
    { ticker: 'TSM', name: 'TSMC', country: 'Taiwan', changePct: 22.0 },
    { ticker: 'SAP', name: 'SAP', country: 'Germany', changePct: 9.8 },
  ],
  financials: [
    { ticker: 'JPM', name: 'JPMorgan Chase', country: 'United States', changePct: 11.2 },
    { ticker: 'BAC', name: 'Bank of America', country: 'United States', changePct: 8.1 },
    { ticker: 'HSBC', name: 'HSBC', country: 'United Kingdom', changePct: 5.6 },
    { ticker: 'V', name: 'Visa', country: 'United States', changePct: 7.9 },
  ],
  'health-care': [
    { ticker: 'JNJ', name: 'Johnson & Johnson', country: 'United States', changePct: 2.4 },
    { ticker: 'PFE', name: 'Pfizer', country: 'United States', changePct: -6.3 },
    { ticker: 'NVO', name: 'Novo Nordisk', country: 'Denmark', changePct: 19.5 },
    { ticker: 'UNH', name: 'UnitedHealth', country: 'United States', changePct: 4.0 },
  ],
  'consumer-discretionary': [
    { ticker: 'AMZN', name: 'Amazon', country: 'United States', changePct: 12.8 },
    { ticker: 'TSLA', name: 'Tesla', country: 'United States', changePct: -9.1 },
    { ticker: 'NKE', name: 'Nike', country: 'United States', changePct: 1.5 },
  ],
  'consumer-staples': [
    { ticker: 'PG', name: 'Procter & Gamble', country: 'United States', changePct: 3.2 },
    { ticker: 'KO', name: 'Coca-Cola', country: 'United States', changePct: 2.0 },
    { ticker: 'NESN', name: 'Nestlé', country: 'Switzerland', changePct: -0.7 },
  ],
  'communication-services': [
    { ticker: 'GOOGL', name: 'Alphabet', country: 'United States', changePct: 13.4 },
    { ticker: 'META', name: 'Meta Platforms', country: 'United States', changePct: 20.6 },
    { ticker: 'NFLX', name: 'Netflix', country: 'United States', changePct: 15.1 },
  ],
  industrials: [
    { ticker: 'CAT', name: 'Caterpillar', country: 'United States', changePct: 6.8 },
    { ticker: 'BA', name: 'Boeing', country: 'United States', changePct: -4.2 },
    { ticker: 'GE', name: 'GE Aerospace', country: 'United States', changePct: 18.0 },
  ],
  energy: [
    { ticker: 'XOM', name: 'ExxonMobil', country: 'United States', changePct: -1.9 },
    { ticker: 'CVX', name: 'Chevron', country: 'United States', changePct: -3.1 },
    { ticker: 'SHEL', name: 'Shell', country: 'United Kingdom', changePct: 2.2 },
  ],
  materials: [
    { ticker: 'LIN', name: 'Linde', country: 'United States', changePct: 5.0 },
    { ticker: 'BHP', name: 'BHP Group', country: 'Australia', changePct: -2.4 },
    { ticker: 'RIO', name: 'Rio Tinto', country: 'United Kingdom', changePct: 0.9 },
  ],
  utilities: [
    { ticker: 'NEE', name: 'NextEra Energy', country: 'United States', changePct: 5.3 },
    { ticker: 'DUK', name: 'Duke Energy', country: 'United States', changePct: 3.1 },
  ],
  'real-estate': [
    { ticker: 'PLD', name: 'Prologis', country: 'United States', changePct: -1.2 },
    { ticker: 'AMT', name: 'American Tower', country: 'United States', changePct: 0.4 },
  ],
};

// ── Lookups ────────────────────────────────────────────────────────────────
export const getRegion = (id: string) => REGIONS.find((r) => r.id === id);
export const getCountry = (id: string) => COUNTRIES.find((c) => c.id === id);
export const getSector = (id: string) => SECTORS.find((s) => s.id === id);
export const countriesInRegion = (regionId: string) =>
  COUNTRIES.filter((c) => c.regionId === regionId);
export const stocksInSector = (sectorId: string) => REPRESENTATIVE_TICKERS[sectorId] ?? [];

// ── Movers ───────────────────────────────────────────────────────────────────
export interface MoverItem {
  key: string;
  label: string;
  sublabel?: string;
  changePct: number;
}

export type Tone = 'bullish' | 'bearish' | 'neutral';
export const changeTone = (pct: number): Tone =>
  pct > 1 ? 'bullish' : pct < -1 ? 'bearish' : 'neutral';

/** Sort movers descending; the panel shows the top N and bottom N. */
export const sortMovers = (items: MoverItem[]) =>
  [...items].sort((a, b) => b.changePct - a.changePct);

export const regionsAsMovers = (): MoverItem[] =>
  REGIONS.map((r) => ({ key: r.id, label: r.name, sublabel: r.emoji, changePct: r.changePct }));
export const countriesAsMovers = (regionId: string): MoverItem[] =>
  countriesInRegion(regionId).map((c) => ({ key: c.id, label: c.name, sublabel: c.flag, changePct: c.changePct }));
export const sectorsAsMovers = (): MoverItem[] =>
  SECTORS.map((s) => ({ key: s.id, label: s.name, sublabel: s.emoji, changePct: s.changePct }));
export const stocksAsMovers = (sectorId: string): MoverItem[] =>
  stocksInSector(sectorId).map((s) => ({ key: s.ticker, label: `${s.ticker} · ${s.name}`, sublabel: s.country, changePct: s.changePct }));

// ── Analyse query templates (fed to the research agent) ──────────────────────
export const analyseGlobalMacro = () =>
  'Provide a concise macro-economic outlook for the global economy and major regions. Highlight key risks and opportunities for equity investors over the next 12 months.';
export const analyseRegion = (name: string) =>
  `Macro-economic outlook and equity-market performance for ${name}. Which countries and sectors look strongest and weakest, and why?`;
export const analyseCountry = (name: string) =>
  `Macro outlook and equity-market performance for ${name}. What are the best and worst performing sectors over the last 12 months, and the key risks?`;
export const analyseSector = (sector: string, country?: string) =>
  `Best and worst performing companies in the ${sector} sector${country ? ` in ${country}` : ' globally'} over the last 12 months. What is driving the dispersion?`;

// ── Sector market weights (SAMPLE, ~%) — used by the sector Pie ───────────────
export const SECTOR_WEIGHTS: Record<string, number> = {
  'information-technology': 30,
  financials: 13,
  'health-care': 11,
  'consumer-discretionary': 10,
  'communication-services': 9,
  industrials: 8,
  'consumer-staples': 6,
  energy: 4,
  materials: 3,
  utilities: 3,
  'real-estate': 3,
};

// ── Asset / ticker metadata model (multi-asset) ──────────────────────────────
export type AssetType =
  | 'equity'
  | 'etf'
  | 'commodity'
  | 'crypto'
  | 'bond'
  | 'real-estate'
  | 'cash'
  | 'mutual-fund'
  | 'derivative';

export type Style = 'growth' | 'value' | 'blend';

export interface AssetTypeMeta {
  id: AssetType;
  name: string;
  emoji: string;
}

export const ASSET_TYPES: AssetTypeMeta[] = [
  { id: 'equity', name: 'Equities', emoji: '📈' },
  { id: 'etf', name: 'ETFs', emoji: '🧺' },
  { id: 'commodity', name: 'Commodities', emoji: '🛢️' },
  { id: 'crypto', name: 'Crypto', emoji: '🪙' },
  { id: 'bond', name: 'Bonds', emoji: '📜' },
  { id: 'real-estate', name: 'Real Estate', emoji: '🏢' },
  { id: 'cash', name: 'Cash', emoji: '💵' },
  { id: 'mutual-fund', name: 'Mutual Funds', emoji: '🏦' },
  { id: 'derivative', name: 'Derivatives', emoji: '🎲' },
];

export interface AssetRef {
  symbol: string;
  name: string;
  assetType: AssetType;
  changePct: number;
  sectorId?: string;
  subSector?: string;
  country?: string;
  market?: Market;
  style?: Style;
  currency?: string;
}

/** Non-equity seed universe. Equities are derived from REPRESENTATIVE_TICKERS. */
const OTHER_ASSETS: AssetRef[] = [
  { symbol: 'SPY', name: 'S&P 500 ETF', assetType: 'etf', changePct: 11.8, country: 'United States', market: 'developed', style: 'blend' },
  { symbol: 'QQQ', name: 'Nasdaq 100 ETF', assetType: 'etf', changePct: 17.2, country: 'United States', market: 'developed', style: 'growth' },
  { symbol: 'EEM', name: 'Emerging Markets ETF', assetType: 'etf', changePct: 4.9, market: 'emerging', style: 'blend' },
  { symbol: 'GLD', name: 'Gold', assetType: 'commodity', changePct: 21.4, currency: 'USD' },
  { symbol: 'WTI', name: 'Crude Oil (WTI)', assetType: 'commodity', changePct: -8.3, currency: 'USD' },
  { symbol: 'BTC', name: 'Bitcoin', assetType: 'crypto', changePct: 34.6, currency: 'USD' },
  { symbol: 'ETH', name: 'Ethereum', assetType: 'crypto', changePct: 12.1, currency: 'USD' },
  { symbol: 'US10Y', name: 'US 10Y Treasury', assetType: 'bond', changePct: 1.2, country: 'United States', currency: 'USD' },
  { symbol: 'TLT', name: '20+ Year Treasury ETF', assetType: 'bond', changePct: -2.7, country: 'United States' },
  { symbol: 'VNQ', name: 'US REIT ETF', assetType: 'real-estate', changePct: 0.6, sectorId: 'real-estate', country: 'United States' },
  { symbol: 'USD', name: 'US Dollar (cash)', assetType: 'cash', changePct: 0.0, currency: 'USD' },
  { symbol: 'VTSAX', name: 'Total Stock Market Fund', assetType: 'mutual-fund', changePct: 11.1, country: 'United States', style: 'blend' },
];

/** Flatten the equity representative tickers into AssetRefs with metadata. */
function equityAssets(): AssetRef[] {
  const out: AssetRef[] = [];
  for (const [sectorId, list] of Object.entries(REPRESENTATIVE_TICKERS)) {
    for (const s of list) {
      const country = COUNTRIES.find((c) => c.name === s.country);
      out.push({
        symbol: s.ticker,
        name: s.name,
        assetType: 'equity',
        changePct: s.changePct,
        sectorId,
        country: s.country,
        market: country?.market,
        style: s.changePct > 15 ? 'growth' : s.changePct < 3 ? 'value' : 'blend',
      });
    }
  }
  return out;
}

export const ASSETS: AssetRef[] = [...equityAssets(), ...OTHER_ASSETS];

export const assetsByType = (type: AssetType | 'all'): AssetRef[] =>
  type === 'all' ? ASSETS : ASSETS.filter((a) => a.assetType === type);

export const assetTypeMeta = (id: AssetType): AssetTypeMeta | undefined =>
  ASSET_TYPES.find((t) => t.id === id);
