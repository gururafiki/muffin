import { fetch as expoFetch } from 'expo/fetch';
import { overrideFetchImplementation } from '@langchain/langgraph-sdk';

/**
 * React Native's built-in `fetch` cannot stream a response body, which the
 * LangGraph SDK relies on for SSE. `expo/fetch` is a spec-compliant,
 * streaming-capable fetch — inject it as the SDK's transport on native.
 * Web is a no-op (browser fetch already streams). See install-fetch.web.ts.
 */
let installed = false;
export function installStreamingFetch() {
  if (installed) return;
  overrideFetchImplementation(expoFetch);
  installed = true;
}
