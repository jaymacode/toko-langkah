import { getConfig } from "@/lib/config";

/**
 * Typed client for the TokoLangkah API (docs/contracts/M1.md and M3M4.md section A).
 * Responses are runtime-validated; anything that does not match the contract
 * becomes an ApiError instead of reaching the UI as unchecked data.
 */

export type ProductSize = {
  size_eu: number;
  in_stock: boolean;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  color: string | null;
  price_idr: number;
  tags: string[];
  image_path: string | null;
  image_alt: string;
  sizes: ProductSize[];
};

export type ProductPage = {
  items: Product[];
  total: number;
};

export type ApiErrorKind =
  | "not_configured"
  | "network"
  | "unauthorized"
  | "service_unavailable"
  | "not_found"
  | "rate_limited"
  | "http_error"
  | "invalid_json"
  | "invalid_response";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** Seconds from a Retry-After header on a 429 response, when the browser may read it; else null. */
  readonly retryAfterSeconds: number | null;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Minimal fetch signature so tests can inject a double without touching globals. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ListProductsOptions = {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
};

export type ClientOptions = {
  baseUrl?: string | null;
  fetchImpl?: FetchLike;
};

/** Options for authenticated calls. The access token is passed separately as the first argument. */
export type AuthedCallOptions = ClientOptions & {
  signal?: AbortSignal;
};

// ---- Account, orders and tickets (M3M4 section A) -------------------------

export type Me = {
  user_id: string;
  customer_stores: string[];
  staff_stores: string[];
};

export type OrderItem = {
  product_name: string;
  size_eu: number;
  quantity: number;
  unit_price_idr: number;
};

export type Order = {
  order_number: string;
  status: string;
  tracking_code: string | null;
  eta_text: string | null;
  updated_at: string;
  items: OrderItem[];
};

export type OrderPage = {
  items: Order[];
};

export const TICKET_STATUSES = ["open", "in_progress", "resolved"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type Ticket = {
  id: string;
  status: TicketStatus;
  reason: string;
  summary: string;
  created_at: string;
  updated_at: string;
};

export type TicketPage = {
  items: Ticket[];
};

/** Staff list rows may carry the customer alias (never the auth UUID). */
export type StaffTicketSummary = Ticket & {
  customer_alias?: string | null;
};

export type StaffTicketPage = {
  items: StaffTicketSummary[];
};

export type TranscriptMessage = {
  role: string;
  content: string;
  created_at: string;
};

export type AuditEvent = {
  action: string;
  actor_id?: string | null;
  created_at: string;
};

export type StaffTicketDetail = Ticket & {
  customer_alias: string | null;
  transcript: TranscriptMessage[];
  audit: AuditEvent[];
};

export type StaffTicketFilter = {
  status?: TicketStatus;
  limit?: number;
  offset?: number;
};

const ORDER_NUMBER_PATTERN = /^[A-Z0-9-]{3,32}$/;
const TICKET_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** Order numbers are identifiers, never proof of identity. The format is checked before any request. */
export function isOrderNumber(value: string): boolean {
  return ORDER_NUMBER_PATTERN.test(value);
}

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === "string" && (TICKET_STATUSES as readonly string[]).includes(value);
}

// ---- Shared runtime guards --------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSize(value: unknown): value is ProductSize {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.size_eu) &&
    typeof value.in_stock === "boolean"
  );
}

/** Images are served from the web origin only; a remote or protocol-relative path is rejected. */
export function isLocalImagePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

export function isProduct(value: unknown): value is Product {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    typeof value.category === "string" &&
    typeof value.description === "string" &&
    (value.color === null || typeof value.color === "string") &&
    isNonNegativeInteger(value.price_idr) &&
    isStringArray(value.tags) &&
    (value.image_path === null || isLocalImagePath(value.image_path)) &&
    typeof value.image_alt === "string" &&
    Array.isArray(value.sizes) &&
    value.sizes.every(isSize)
  );
}

export function isProductPage(value: unknown): value is ProductPage {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isProduct) &&
    isNonNegativeInteger(value.total)
  );
}

export function isMe(value: unknown): value is Me {
  return (
    isRecord(value) &&
    typeof value.user_id === "string" &&
    isStringArray(value.customer_stores) &&
    isStringArray(value.staff_stores)
  );
}

export function isOrderItem(value: unknown): value is OrderItem {
  return (
    isRecord(value) &&
    typeof value.product_name === "string" &&
    isNonNegativeInteger(value.size_eu) &&
    isNonNegativeInteger(value.quantity) &&
    isNonNegativeInteger(value.unit_price_idr)
  );
}

export function isOrder(value: unknown): value is Order {
  return (
    isRecord(value) &&
    typeof value.order_number === "string" &&
    isOrderNumber(value.order_number) &&
    typeof value.status === "string" &&
    isNullableString(value.tracking_code) &&
    isNullableString(value.eta_text) &&
    isTimestamp(value.updated_at) &&
    Array.isArray(value.items) &&
    value.items.every(isOrderItem)
  );
}

export function isOrderPage(value: unknown): value is OrderPage {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isOrder);
}

export function isTicket(value: unknown): value is Ticket {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isTicketStatus(value.status) &&
    typeof value.reason === "string" &&
    typeof value.summary === "string" &&
    isTimestamp(value.created_at) &&
    isTimestamp(value.updated_at)
  );
}

export function isTicketPage(value: unknown): value is TicketPage {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isTicket);
}

function isStaffTicketSummary(value: unknown): value is StaffTicketSummary {
  if (!isTicket(value)) return false;
  const extra = value as unknown as Record<string, unknown>;
  return extra.customer_alias === undefined || isNullableString(extra.customer_alias);
}

export function isStaffTicketPage(value: unknown): value is StaffTicketPage {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isStaffTicketSummary);
}

function isTranscriptMessage(value: unknown): value is TranscriptMessage {
  return (
    isRecord(value) &&
    typeof value.role === "string" &&
    typeof value.content === "string" &&
    isTimestamp(value.created_at)
  );
}

function isAuditEvent(value: unknown): value is AuditEvent {
  return (
    isRecord(value) &&
    typeof value.action === "string" &&
    (value.actor_id === undefined || isNullableString(value.actor_id)) &&
    isTimestamp(value.created_at)
  );
}

export function isStaffTicketDetail(value: unknown): value is StaffTicketDetail {
  if (!isTicket(value)) return false;
  const extra = value as unknown as Record<string, unknown>;
  return (
    isNullableString(extra.customer_alias) &&
    Array.isArray(extra.transcript) &&
    extra.transcript.every(isTranscriptMessage) &&
    Array.isArray(extra.audit) &&
    extra.audit.every(isAuditEvent)
  );
}

// ---- Transport --------------------------------------------------------------

function resolveBaseUrl(options: ClientOptions): string | null {
  if (options.baseUrl !== undefined) {
    return options.baseUrl;
  }
  return getConfig().apiBaseUrl;
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 503) return "service_unavailable";
  return "http_error";
}

type RequestInput = {
  method: "GET" | "POST" | "PATCH";
  body?: unknown;
  /** Set for authenticated calls; sent only as an Authorization header. */
  accessToken?: string;
  signal?: AbortSignal;
};

/** Parses a Retry-After header given in seconds. HTTP-date values and other text yield null. */
function retryAfterOf(response: Response): number | null {
  const raw = response.headers.get("Retry-After");
  if (raw === null || !/^\d{1,6}$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

/** Shared JSON transport. Exported for the chat client in chat-api.ts; screens call the typed functions. */
export async function requestJson(path: string, options: ClientOptions, request: RequestInput): Promise<unknown> {
  const baseUrl = resolveBaseUrl(options);
  if (baseUrl === null) {
    throw new ApiError("not_configured", "NEXT_PUBLIC_API_BASE_URL is not set.");
  }
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

  const headers: Record<string, string> = { Accept: "application/json" };
  if (request.accessToken !== undefined) {
    headers.Authorization = `Bearer ${request.accessToken}`;
  }
  let body: string | undefined;
  if (request.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(request.body);
  }

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      cache: "no-store",
      credentials: "omit",
      ...(request.signal ? { signal: request.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError("network", "The catalogue API could not be reached.");
  }

  if (!response.ok) {
    throw new ApiError(
      kindForStatus(response.status),
      `The catalogue API returned HTTP ${response.status}.`,
      response.status,
      response.status === 429 ? retryAfterOf(response) : null,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new ApiError("invalid_json", "The catalogue API returned a body that is not JSON.", response.status);
  }
}

function invalidResponse(): ApiError {
  return new ApiError("invalid_response", "The catalogue API response does not match the contract.");
}

// ---- Public catalogue calls -------------------------------------------------

export async function listProducts(
  listOptions: ListProductsOptions = {},
  clientOptions: ClientOptions = {},
): Promise<ProductPage> {
  const limit = listOptions.limit ?? 20;
  const offset = listOptions.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError("limit must be an integer from 1 to 50");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("offset must be a non-negative integer");
  }
  const body = await requestJson(`/products?limit=${limit}&offset=${offset}`, clientOptions, {
    method: "GET",
    ...(listOptions.signal ? { signal: listOptions.signal } : {}),
  });
  if (!isProductPage(body)) {
    throw invalidResponse();
  }
  return body;
}

export async function getProduct(
  slug: string,
  clientOptions: ClientOptions & { signal?: AbortSignal } = {},
): Promise<Product> {
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) {
    throw new RangeError("slug must be lowercase letters, digits or hyphens");
  }
  const { signal, ...rest } = clientOptions;
  const body = await requestJson(`/products/${slug}`, rest, {
    method: "GET",
    ...(signal ? { signal } : {}),
  });
  if (!isProduct(body)) {
    throw invalidResponse();
  }
  return body;
}

// ---- Authenticated calls ----------------------------------------------------

type AuthedRequest = { client: ClientOptions; request: { accessToken: string; signal?: AbortSignal } };

function authed(accessToken: string, options: AuthedCallOptions): AuthedRequest {
  const client: ClientOptions = {};
  if (options.baseUrl !== undefined) client.baseUrl = options.baseUrl;
  if (options.fetchImpl !== undefined) client.fetchImpl = options.fetchImpl;
  return {
    client,
    request: options.signal ? { accessToken, signal: options.signal } : { accessToken },
  };
}

export async function getMe(accessToken: string, options: AuthedCallOptions = {}): Promise<Me> {
  const { client, request } = authed(accessToken, options);
  const body = await requestJson("/me", client, { method: "GET", ...request });
  if (!isMe(body)) throw invalidResponse();
  return body;
}

export async function listOrders(accessToken: string, options: AuthedCallOptions = {}): Promise<OrderPage> {
  const { client, request } = authed(accessToken, options);
  const body = await requestJson("/orders", client, { method: "GET", ...request });
  if (!isOrderPage(body)) throw invalidResponse();
  return body;
}

/** An order number that fails the format check is reported as not_found without a request. */
export async function getOrder(
  orderNumber: string,
  accessToken: string,
  options: AuthedCallOptions = {},
): Promise<Order> {
  if (!isOrderNumber(orderNumber)) {
    throw new ApiError("not_found", "Order or ticket not found.", 404);
  }
  const { client, request } = authed(accessToken, options);
  const body = await requestJson(`/orders/${orderNumber}`, client, { method: "GET", ...request });
  if (!isOrder(body)) throw invalidResponse();
  return body;
}

export async function listTickets(accessToken: string, options: AuthedCallOptions = {}): Promise<TicketPage> {
  const { client, request } = authed(accessToken, options);
  const body = await requestJson("/tickets", client, { method: "GET", ...request });
  if (!isTicketPage(body)) throw invalidResponse();
  return body;
}

export async function listStaffTickets(
  accessToken: string,
  filter: StaffTicketFilter = {},
  options: AuthedCallOptions = {},
): Promise<StaffTicketPage> {
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("limit must be an integer from 1 to 100");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("offset must be a non-negative integer");
  }
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (filter.status !== undefined) {
    if (!isTicketStatus(filter.status)) throw new RangeError("status must be a ticket status");
    params.set("status", filter.status);
  }
  const { client, request } = authed(accessToken, options);
  const body = await requestJson(`/staff/tickets?${params.toString()}`, client, { method: "GET", ...request });
  if (!isStaffTicketPage(body)) throw invalidResponse();
  return body;
}

/** A ticket id that fails the format check is reported as not_found without a request. */
export async function getStaffTicket(
  ticketId: string,
  accessToken: string,
  options: AuthedCallOptions = {},
): Promise<StaffTicketDetail> {
  if (!TICKET_ID_PATTERN.test(ticketId)) {
    throw new ApiError("not_found", "Order or ticket not found.", 404);
  }
  const { client, request } = authed(accessToken, options);
  const body = await requestJson(`/staff/tickets/${ticketId}`, client, { method: "GET", ...request });
  if (!isStaffTicketDetail(body)) throw invalidResponse();
  return body;
}

export async function updateStaffTicketStatus(
  ticketId: string,
  status: TicketStatus,
  accessToken: string,
  options: AuthedCallOptions = {},
): Promise<Ticket> {
  if (!TICKET_ID_PATTERN.test(ticketId)) {
    throw new ApiError("not_found", "Order or ticket not found.", 404);
  }
  if (!isTicketStatus(status)) throw new RangeError("status must be a ticket status");
  const { client, request } = authed(accessToken, options);
  const body = await requestJson(`/staff/tickets/${ticketId}`, client, {
    method: "PATCH",
    body: { status },
    ...request,
  });
  if (!isTicket(body)) throw invalidResponse();
  return body;
}

/** Turns any thrown value into a user-facing ApiError kind for display. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError("network", "The catalogue API could not be reached.");
}
