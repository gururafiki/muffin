/**
 * Wealth model — account wrappers, holdings and goals.
 *
 * Seeded demo data, editable locally and persisted via the store (store.ts).
 * Holdings reference assets by `symbol` (resolved against the markets taxonomy
 * for name/sector/asset-type). Single base currency for now (multi-currency is
 * a tracked follow-up). All numbers are illustrative SAMPLE data.
 */
import { ASSETS, assetTypeMeta, type AssetType } from '@/features/markets/taxonomy';

export type AccountType = 'sipp' | 'isa' | 'lisa' | 'gia' | 'cash' | 'property' | 'mortgage' | 'other';

export interface AccountTypeMeta {
  id: AccountType;
  name: string;
  emoji: string;
  kind: 'asset' | 'liability';
  blurb: string;
  holdings: boolean; // true → holds securities; false → a single balance
}

export const ACCOUNT_TYPES: AccountTypeMeta[] = [
  { id: 'sipp', name: 'SIPP', emoji: '🏖️', kind: 'asset', blurb: 'Self-invested pension', holdings: true },
  { id: 'isa', name: 'ISA', emoji: '🛡️', kind: 'asset', blurb: 'Tax-free stocks & shares', holdings: true },
  { id: 'lisa', name: 'LISA', emoji: '🔑', kind: 'asset', blurb: 'Lifetime ISA', holdings: true },
  { id: 'gia', name: 'GIA', emoji: '📈', kind: 'asset', blurb: 'General investment account', holdings: true },
  { id: 'cash', name: 'Cash', emoji: '💵', kind: 'asset', blurb: 'Savings & cash', holdings: false },
  { id: 'property', name: 'Property', emoji: '🏠', kind: 'asset', blurb: 'Real estate', holdings: false },
  { id: 'mortgage', name: 'Mortgage', emoji: '🏦', kind: 'liability', blurb: 'Home loan', holdings: false },
  { id: 'other', name: 'Other', emoji: '📦', kind: 'asset', blurb: 'Other holdings', holdings: false },
];

export const accountTypeMeta = (t: AccountType): AccountTypeMeta =>
  ACCOUNT_TYPES.find((m) => m.id === t) ?? ACCOUNT_TYPES[ACCOUNT_TYPES.length - 1];

export interface Holding {
  id: string;
  symbol: string;
  units: number;
  price: number;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  holdings: Holding[];
  /** For balance-based accounts (cash/property/mortgage). Mortgage is negative. */
  balance?: number;
}

export interface Goal {
  id: string;
  name: string;
  emoji: string;
  targetAmount: number;
  currentAmount: number;
  /** ISO date (yyyy-mm-dd). */
  targetDate?: string;
}

// ── Calculations ─────────────────────────────────────────────────────────────
export const holdingValue = (h: Holding): number => h.units * h.price;

export function accountValue(a: Account): number {
  if (a.holdings.length) return a.holdings.reduce((s, h) => s + holdingValue(h), 0);
  return a.balance ?? 0;
}

export const netWorth = (accounts: Account[]): number =>
  accounts.reduce((s, a) => s + accountValue(a), 0);

export const totalAssets = (accounts: Account[]): number =>
  accounts.filter((a) => accountValue(a) > 0).reduce((s, a) => s + accountValue(a), 0);

export const totalLiabilities = (accounts: Account[]): number =>
  accounts.filter((a) => accountValue(a) < 0).reduce((s, a) => s + accountValue(a), 0);

export const assetForSymbol = (symbol: string) => ASSETS.find((x) => x.symbol === symbol);

export interface AllocationSlice {
  key: string;
  label: string;
  value: number;
}

/** Allocation of positive (asset) value by underlying asset type. */
export function allocationByAssetType(accounts: Account[]): AllocationSlice[] {
  const totals = new Map<AssetType, number>();
  const add = (t: AssetType, v: number) => totals.set(t, (totals.get(t) ?? 0) + v);
  for (const a of accounts) {
    if (a.holdings.length) {
      for (const h of a.holdings) add(assetForSymbol(h.symbol)?.assetType ?? 'equity', holdingValue(h));
    } else if (a.type === 'cash') {
      add('cash', a.balance ?? 0);
    } else if (a.type === 'property') {
      add('real-estate', a.balance ?? 0);
    }
    // liabilities (mortgage) are excluded from the asset allocation
  }
  return [...totals.entries()]
    .filter(([, v]) => v > 0)
    .map(([t, v]) => ({ key: t, label: assetTypeMeta(t)?.name ?? t, value: v }))
    .sort((x, y) => y.value - x.value);
}

/** Allocation by account (positive value only). */
export function allocationByAccount(accounts: Account[]): AllocationSlice[] {
  return accounts
    .map((a) => ({ key: a.id, label: a.name, value: accountValue(a) }))
    .filter((s) => s.value > 0)
    .sort((x, y) => y.value - x.value);
}

export const goalProgress = (g: Goal): number =>
  g.targetAmount > 0 ? Math.max(0, Math.min(1, g.currentAmount / g.targetAmount)) : 0;

/** Currency-format without depending on Intl (consistent across platforms). */
export function formatMoney(n: number, currency = '£'): string {
  const neg = n < 0;
  const rounded = Math.round(Math.abs(n));
  const grouped = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${currency}${grouped}`;
}

export const uid = (): string => Math.random().toString(36).slice(2, 10);

// ── Demo seed ────────────────────────────────────────────────────────────────
export const DEMO_ACCOUNTS: Account[] = [
  {
    id: 'acc-sipp',
    name: 'Pension (SIPP)',
    type: 'sipp',
    holdings: [
      { id: 'h1', symbol: 'SPY', units: 40, price: 520 },
      { id: 'h2', symbol: 'QQQ', units: 20, price: 440 },
    ],
  },
  {
    id: 'acc-isa',
    name: 'Stocks & Shares ISA',
    type: 'isa',
    holdings: [
      { id: 'h3', symbol: 'AAPL', units: 30, price: 225 },
      { id: 'h4', symbol: 'MSFT', units: 15, price: 420 },
      { id: 'h5', symbol: 'NVDA', units: 10, price: 120 },
    ],
  },
  {
    id: 'acc-gia',
    name: 'General Investment',
    type: 'gia',
    holdings: [
      { id: 'h6', symbol: 'GLD', units: 10, price: 210 },
      { id: 'h7', symbol: 'BTC', units: 0.2, price: 65000 },
    ],
  },
  { id: 'acc-cash', name: 'Cash savings', type: 'cash', holdings: [], balance: 15000 },
  { id: 'acc-home', name: 'Home', type: 'property', holdings: [], balance: 450000 },
  { id: 'acc-mortgage', name: 'Mortgage', type: 'mortgage', holdings: [], balance: -310000 },
];

export const DEMO_GOALS: Goal[] = [
  { id: 'goal-retire', name: 'Retirement', emoji: '🏝️', targetAmount: 1000000, currentAmount: 58950, targetDate: '2050-01-01' },
  { id: 'goal-house', name: 'House deposit', emoji: '🏡', targetAmount: 60000, currentAmount: 22000, targetDate: '2027-06-01' },
];
