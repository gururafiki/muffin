/**
 * The 13 investor personas in the council graph (muffin-agent
 * personas_council). Slugs match `agent_id` in the streamed `persona_signals`.
 * Metadata (emoji + one-line style) is UI flavour to give each avatar
 * personality — it does not affect the agent.
 */
export interface PersonaMeta {
  slug: string;
  name: string;
  emoji: string;
  style: string;
}

export const COUNCIL_PERSONAS: PersonaMeta[] = [
  { slug: 'warren_buffett', name: 'Warren Buffett', emoji: '🧀', style: 'Quality at a fair price' },
  { slug: 'ben_graham', name: 'Ben Graham', emoji: '📐', style: 'Margin of safety' },
  { slug: 'cathie_wood', name: 'Cathie Wood', emoji: '🚀', style: 'Disruptive innovation' },
  { slug: 'charlie_munger', name: 'Charlie Munger', emoji: '🧠', style: 'Mental models, moats' },
  { slug: 'bill_ackman', name: 'Bill Ackman', emoji: '🎯', style: 'Concentrated activism' },
  { slug: 'michael_burry', name: 'Michael Burry', emoji: '🔬', style: 'Deep-value contrarian' },
  { slug: 'mohnish_pabrai', name: 'Mohnish Pabrai', emoji: '🃏', style: 'Heads I win, tails…' },
  { slug: 'nassim_taleb', name: 'Nassim Taleb', emoji: '🦢', style: 'Antifragile, tail risk' },
  { slug: 'peter_lynch', name: 'Peter Lynch', emoji: '🛒', style: 'Buy what you know' },
  { slug: 'phil_fisher', name: 'Phil Fisher', emoji: '🌱', style: 'Scuttlebutt growth' },
  { slug: 'rakesh_jhunjhunwala', name: 'Rakesh Jhunjhunwala', emoji: '🐯', style: 'India growth bull' },
  { slug: 'stanley_druckenmiller', name: 'Stan Druckenmiller', emoji: '🌊', style: 'Macro, liquidity' },
  { slug: 'aswath_damodaran', name: 'Aswath Damodaran', emoji: '🧮', style: 'Valuation, story→numbers' },
];

const BY_SLUG = new Map(COUNCIL_PERSONAS.map((p) => [p.slug, p]));

export const prettyPersona = (slug: string): string =>
  BY_SLUG.get(slug)?.name ?? slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Normalise a streamed agent_id to a known persona slug, if possible. */
export function normalizeSlug(raw: string | undefined): string {
  if (!raw) return '';
  const s = raw.toLowerCase().replace(/[\s-]+/g, '_');
  return BY_SLUG.has(s) ? s : s;
}

export const getPersonaMeta = (slug: string): PersonaMeta | undefined => BY_SLUG.get(slug);
