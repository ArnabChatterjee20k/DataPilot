import type { CreateClientConfig } from "./sdk/client.gen";

/**
 * The API origin. In dev the console runs on Vite's port and the server on its
 * own, so they differ; when the server serves the built console they are the
 * same origin and a relative URL is correct.
 */
const baseUrl =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:8000" : "");

export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl,
});
