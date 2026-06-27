import { Client } from '@langchain/langgraph-sdk';

import { buildAuthHeaders } from '@/lib/settings/configurable';
import type { Settings } from '@/lib/settings/store';
import { installStreamingFetch } from './install-fetch';

/**
 * Build a LangGraph SDK client from the user's settings. The streaming-fetch
 * shim is installed once (native only) so `runs.stream` works on iOS/Android.
 */
export function makeClient(settings: Settings): Client {
  installStreamingFetch();
  return new Client({
    apiUrl: settings.apiUrl,
    defaultHeaders: buildAuthHeaders(settings),
  });
}
