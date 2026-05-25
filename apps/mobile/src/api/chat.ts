import {
  HOBO_CLIENT_ID_HEADER,
  JSON_CONTENT_TYPE,
  type ChatErrorResponse,
  type ChatRequest,
  type ChatResponse
} from "@hobo/shared";

export class ChatApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ChatApiError";
  }
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as Partial<ChatErrorResponse>;
    return body.error || `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

export async function sendChat(
  proxyUrl: string,
  clientId: string,
  payload: ChatRequest
): Promise<ChatResponse> {
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": JSON_CONTENT_TYPE,
      [HOBO_CLIENT_ID_HEADER]: clientId
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new ChatApiError(await readError(response), response.status);
  }

  return (await response.json()) as ChatResponse;
}
