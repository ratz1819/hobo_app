export const CHAT_ENDPOINT_PATH = "/chat";
export const HOBO_CLIENT_ID_HEADER = "X-Hobo-Client-ID";
export const JSON_CONTENT_TYPE = "application/json";

export const PROVIDER_NAMES = ["groq", "google", "cerebras"] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  systemPrompt?: string;
};

export type ChatResponse = {
  text: string;
  routedProvider: ProviderName;
};

export type ChatErrorResponse = {
  error: string;
};
