import type { Settings } from './store';

/**
 * Map user settings → LangGraph `config.configurable`.
 *
 * Field names mirror muffin-agent's `ModelConfiguration` / `McpConfiguration`
 * (src/muffin_agent/model_config.py, mcp_config.py), which read these straight
 * out of `configurable`. Only non-empty values are forwarded so we never clobber
 * a server default with a blank string.
 */
export function buildConfigurable(settings: Settings): Record<string, unknown> {
  const cfg: Record<string, unknown> = { llm_provider: settings.llmProvider };

  const put = (key: string, value: string) => {
    if (value && value.trim()) cfg[key] = value.trim();
  };

  put('user_id', settings.userId);
  put('model', settings.model);
  put('openai_api_key', settings.openaiApiKey);
  put('anthropic_api_key', settings.anthropicApiKey);
  put('openrouter_api_key', settings.openrouterApiKey);
  // OpenBB BYO key — forwarded for when the backend wires per-user market-data
  // auth (M2). Harmless if the server ignores unknown configurable keys.
  put('openbb_api_key', settings.openbbApiKey);

  return cfg;
}

/** Auth header for the LangGraph API, if a token is configured. */
export function buildAuthHeaders(settings: Settings): Record<string, string> {
  return settings.authToken.trim()
    ? { Authorization: `Bearer ${settings.authToken.trim()}` }
    : {};
}
