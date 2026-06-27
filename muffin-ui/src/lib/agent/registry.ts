/**
 * Agent registry — "one graph → one screen".
 *
 * Each entry maps a LangGraph `assistant_id` (from muffin-agent/langgraph.json)
 * to the inputs its UI collects, how to shape the run `input`, and which state
 * key carries the headline result. Adding a new agent = add one entry here; the
 * generic runner handles the rest. A `custom` key opts an agent into a bespoke
 * screen (e.g. the council avatars) instead of the generic transcript view.
 */
export type CustomScreen = 'council';

export interface AgentInputField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  autoCapitalize?: 'characters' | 'none';
}

export interface AgentDef {
  /** assistant_id / graph name registered in langgraph.json */
  id: string;
  title: string;
  emoji: string;
  tagline: string;
  inputs: AgentInputField[];
  /** Shape the collected field values into the graph's run `input`. */
  buildInput: (values: Record<string, string>) => Record<string, unknown>;
  /** State key holding the final structured output, for headline rendering. */
  resultKey?: string;
  /** Optional tailored renderer for the result (else generic StructuredOutput). */
  resultRenderer?: 'research';
  custom?: CustomScreen;
}

const ticker: AgentInputField = {
  key: 'ticker',
  label: 'Ticker',
  placeholder: 'AAPL',
  required: true,
  autoCapitalize: 'characters',
};

export const AGENTS: AgentDef[] = [
  {
    id: 'research',
    title: 'Deep Research',
    emoji: '🔎',
    tagline: 'Web research with cited, reranked evidence.',
    inputs: [
      { key: 'query', label: 'Question', placeholder: 'What is driving NVDA revenue growth?', required: true },
    ],
    buildInput: (v) => ({ query: v.query }),
    resultKey: 'output',
    resultRenderer: 'research',
  },
  {
    id: 'council',
    title: 'Investor Council',
    emoji: '🧑‍⚖️',
    tagline: '13 famous-investor personas debate, then a judge synthesises.',
    inputs: [ticker, { key: 'query', label: 'Focus (optional)', placeholder: 'Is the moat durable?' }],
    buildInput: (v) => ({ ticker: v.ticker?.toUpperCase(), ...(v.query ? { query: v.query } : {}) }),
    resultKey: 'council_synthesis',
    custom: 'council',
  },
  {
    id: 'criteria_analysis',
    title: 'Criteria Analysis',
    emoji: '📊',
    tagline: 'Sector-aware, criteria-driven scoring and synthesis.',
    inputs: [ticker, { key: 'query', label: 'Focus (optional)', placeholder: 'Buy at current price?' }],
    // `sector`/`market` may arrive via initialValues from a sector/country
    // context to pre-classify the run (CriteriaAnalysisState accepts them).
    buildInput: (v) => ({
      ticker: v.ticker?.toUpperCase(),
      ...(v.query ? { query: v.query } : {}),
      ...(v.sector ? { sector: v.sector } : {}),
      ...(v.market ? { market: v.market } : {}),
    }),
    resultKey: 'synthesis',
  },
  {
    id: 'stock_evaluation',
    title: 'Stock Evaluation',
    emoji: '🧁',
    tagline: 'Full deep-agent evaluation: plan, collect, validate, analyse.',
    inputs: [
      { key: 'prompt', label: 'Prompt', placeholder: 'Evaluate AAPL as a long-term holding', required: true },
    ],
    buildInput: (v) => ({ messages: [{ type: 'human', content: v.prompt }] }),
    resultKey: 'messages',
  },
];

export const getAgent = (id: string): AgentDef | undefined => AGENTS.find((a) => a.id === id);
