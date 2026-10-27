import {
  ApiError,
  isLocalImagePath,
  isNonNegativeInteger,
  isNullableString,
  isOrder,
  isRecord,
  isStringArray,
  isTicket,
  requestJson,
} from "@/lib/api";
import type { AuthedCallOptions, ClientOptions, Order, Ticket } from "@/lib/api";

/**
 * Typed client for the assistant turn API (docs/contracts/M4.md, "Turn API").
 * Every response is runtime-validated before the UI sees it. Unknown extra fields
 * are tolerated; required fields and their types are enforced. All text in these
 * shapes is data: the UI renders it as text only, never as HTML.
 */

export const NEXT_ACTIONS = ["answer", "clarify", "abstain", "offer_escalation", "escalated"] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export const ASSISTANT_PROVIDERS = ["rules", "openai"] as const;
export type AssistantProvider = (typeof ASSISTANT_PROVIDERS)[number];

/** Product filters. Every key is present in a response; null means "not set". */
export type ProductFilters = {
  category: string | null;
  price_lt: number | null;
  price_lte: number | null;
  size_eu: number | null;
  color: string | null;
  keywords: string[];
  unparsed_budget: number | null;
};

export type ProductHit = {
  external_id: string;
  slug: string;
  name: string;
  price_idr: number;
  color: string | null;
  sizes_in_stock: number[];
  matched_terms: string[];
  /** Optional so older payloads still validate; null/absent renders a text placeholder. */
  image_path?: string | null;
  image_alt?: string;
};

/** One policy chunk returned as quoted data. */
export type Evidence = {
  chunk_id: string;
  title: string;
  section: string;
  version: string;
  excerpt: string;
};

export type TurnEnvelope = {
  message_id: string;
  answer: string;
  next_action: NextAction;
  citations: Evidence[];
  products: ProductHit[];
  filters: ProductFilters | null;
  order: Order | null;
  ticket: Ticket | null;
  provider: AssistantProvider;
};

export type TurnRequest = {
  content: string;
  client_message_id: string;
  filters: ProductFilters | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

export function isEvidence(value: unknown): value is Evidence {
  return (
    isRecord(value) &&
    typeof value.chunk_id === "string" &&
    typeof value.title === "string" &&
    typeof value.section === "string" &&
    typeof value.version === "string" &&
    typeof value.excerpt === "string"
  );
}

export function isProductHit(value: unknown): value is ProductHit {
  return (
    isRecord(value) &&
    typeof value.external_id === "string" &&
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    isNonNegativeInteger(value.price_idr) &&
    isNullableString(value.color) &&
    Array.isArray(value.sizes_in_stock) &&
    value.sizes_in_stock.every(isNonNegativeInteger) &&
    isStringArray(value.matched_terms) &&
    (value.image_path === undefined || value.image_path === null || isLocalImagePath(value.image_path)) &&
    (value.image_alt === undefined || typeof value.image_alt === "string")
  );
}

export function isProductFilters(value: unknown): value is ProductFilters {
  return (
    isRecord(value) &&
    isNullableString(value.category) &&
    isNullableNonNegativeInteger(value.price_lt) &&
    isNullableNonNegativeInteger(value.price_lte) &&
    isNullableNonNegativeInteger(value.size_eu) &&
    isNullableString(value.color) &&
    isStringArray(value.keywords) &&
    isNullableNonNegativeInteger(value.unparsed_budget)
  );
}

export function isNextAction(value: unknown): value is NextAction {
  return typeof value === "string" && (NEXT_ACTIONS as readonly string[]).includes(value);
}

export function isAssistantProvider(value: unknown): value is AssistantProvider {
  return typeof value === "string" && (ASSISTANT_PROVIDERS as readonly string[]).includes(value);
}

export function isTurnEnvelope(value: unknown): value is TurnEnvelope {
  return (
    isRecord(value) &&
    typeof value.message_id === "string" &&
    UUID_PATTERN.test(value.message_id) &&
    typeof value.answer === "string" &&
    isNextAction(value.next_action) &&
    Array.isArray(value.citations) &&
    value.citations.every(isEvidence) &&
    Array.isArray(value.products) &&
    value.products.every(isProductHit) &&
    (value.filters === null || isProductFilters(value.filters)) &&
    (value.order === null || isOrder(value.order)) &&
    (value.ticket === null || isTicket(value.ticket)) &&
    isAssistantProvider(value.provider)
  );
}

function invalidResponse(): ApiError {
  return new ApiError("invalid_response", "The assistant API response does not match the contract.");
}

function clientOf(options: AuthedCallOptions): ClientOptions {
  const client: ClientOptions = {};
  if (options.baseUrl !== undefined) client.baseUrl = options.baseUrl;
  if (options.fetchImpl !== undefined) client.fetchImpl = options.fetchImpl;
  return client;
}

/** Creates a conversation for the signed-in customer. Returns its id. */
export async function createConversation(accessToken: string, options: AuthedCallOptions = {}): Promise<string> {
  const body = await requestJson("/conversations", clientOf(options), {
    method: "POST",
    accessToken,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!isRecord(body) || typeof body.id !== "string" || !ID_PATTERN.test(body.id)) {
    throw invalidResponse();
  }
  return body.id;
}

/**
 * Sends one customer turn. The same client_message_id on a retry lets the server
 * return the stored envelope instead of creating a second message or ticket.
 */
export async function sendTurn(
  accessToken: string,
  conversationId: string,
  turn: TurnRequest,
  options: AuthedCallOptions = {},
): Promise<TurnEnvelope> {
  if (!ID_PATTERN.test(conversationId)) {
    throw new ApiError("not_found", "Conversation not found.", 404);
  }
  const body = await requestJson(`/conversations/${conversationId}/messages`, clientOf(options), {
    method: "POST",
    accessToken,
    body: turn,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!isTurnEnvelope(body)) throw invalidResponse();
  return body;
}

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

/** Filters and products of the newest assistant turn. Restores the chips and the product panel. */
export type LatestTurn = {
  filters: ProductFilters | null;
  products: ProductHit[];
};

export type ConversationHistory = {
  id: string;
  messages: ConversationMessage[];
  latest: LatestTurn | null;
};

/** Runtime guard for the restore field. Extra fields are tolerated; the typed fields must match. */
export function isLatestTurn(value: unknown): value is LatestTurn {
  return (
    isRecord(value) &&
    (value.filters === null || isProductFilters(value.filters)) &&
    Array.isArray(value.products) &&
    value.products.every(isProductHit)
  );
}

/**
 * Reads the transcript of one of the caller's conversations (GET /conversations/{id}).
 * Assistant rows carry plain text only. `latest` holds the filters and products of the newest
 * product turn, so the chips and the product panel can be restored too.
 */
export async function getConversation(
  accessToken: string,
  conversationId: string,
  options: AuthedCallOptions = {},
): Promise<ConversationHistory> {
  if (!ID_PATTERN.test(conversationId)) {
    throw new ApiError("not_found", "Conversation not found.", 404);
  }
  const body = await requestJson(`/conversations/${conversationId}`, clientOf(options), {
    method: "GET",
    accessToken,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (
    !isRecord(body) ||
    typeof body.id !== "string" ||
    !Array.isArray(body.messages) ||
    !body.messages.every(isConversationMessage)
  ) {
    throw invalidResponse();
  }
  // An absent field (older API) reads as null; a present value must match the guard.
  const latest = body.latest === undefined || body.latest === null ? null : body.latest;
  if (latest !== null && !isLatestTurn(latest)) throw invalidResponse();
  return { id: body.id, messages: body.messages, latest: latest as LatestTurn | null };
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  return (
    isRecord(value) &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    typeof value.created_at === "string"
  );
}

/** Reads the assistant provider label from GET /health (no credentials). */
export async function getHealthProvider(options: ClientOptions = {}): Promise<string> {
  const body = await requestJson("/health", options, { method: "GET" });
  if (!isRecord(body) || typeof body.assistant_provider !== "string") throw invalidResponse();
  return body.assistant_provider;
}
