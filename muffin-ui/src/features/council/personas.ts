/** The 13 investor personas in the council graph (personas_council). */
export const COUNCIL_PERSONAS = [
  'warren_buffett',
  'ben_graham',
  'cathie_wood',
  'charlie_munger',
  'bill_ackman',
  'michael_burry',
  'mohnish_pabrai',
  'nassim_taleb',
  'peter_lynch',
  'phil_fisher',
  'rakesh_jhunjhunwala',
  'stanley_druckenmiller',
  'aswath_damodaran',
] as const;

export const prettyPersona = (slug: string): string =>
  slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
