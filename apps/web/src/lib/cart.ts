/**
 * Demo cart. Lives only in this browser (localStorage); it never reaches the API and never
 * creates an order, because the PRD has no payments. Prices are never stored here: the cart
 * page re-reads every product from the catalogue API, so a stale price or a size that sold
 * out since it was added is shown from current data, not from what was saved.
 */

export const CART_STORAGE_KEY = "tokolangkah.cart.v1";
export const MAX_LINE_QUANTITY = 5;
const MAX_LINES = 20;

export type CartLine = {
  slug: string;
  size_eu: number;
  quantity: number;
};

const SLUG_RE = /^[a-z0-9-]{1,100}$/;

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.slug === "string" &&
    SLUG_RE.test(line.slug) &&
    Number.isSafeInteger(line.size_eu) &&
    Number.isSafeInteger(line.quantity) &&
    (line.quantity as number) >= 1 &&
    (line.quantity as number) <= MAX_LINE_QUANTITY
  );
}

/** Parses stored JSON; anything malformed is dropped rather than trusted. */
export function parseCart(raw: string | null): CartLine[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Only the three known fields survive; anything else stored (e.g. a price) is discarded.
    return parsed
      .filter(isCartLine)
      .slice(0, MAX_LINES)
      .map(({ slug, size_eu, quantity }) => ({ slug, size_eu, quantity }));
  } catch {
    return [];
  }
}

export function sameLine(a: Pick<CartLine, "slug" | "size_eu">, b: Pick<CartLine, "slug" | "size_eu">): boolean {
  return a.slug === b.slug && a.size_eu === b.size_eu;
}

/** Adds one pair; the same shoe in the same size merges into one line, capped at MAX_LINE_QUANTITY. */
export function addLine(lines: CartLine[], slug: string, sizeEu: number): CartLine[] {
  const existing = lines.find((line) => sameLine(line, { slug, size_eu: sizeEu }));
  if (existing) {
    return lines.map((line) =>
      line === existing ? { ...line, quantity: Math.min(MAX_LINE_QUANTITY, line.quantity + 1) } : line,
    );
  }
  return [...lines, { slug, size_eu: sizeEu, quantity: 1 }].slice(0, MAX_LINES);
}

export function setQuantity(lines: CartLine[], target: CartLine, quantity: number): CartLine[] {
  const clamped = Math.max(1, Math.min(MAX_LINE_QUANTITY, Math.trunc(quantity)));
  return lines.map((line) => (sameLine(line, target) ? { ...line, quantity: clamped } : line));
}

export function removeLine(lines: CartLine[], target: CartLine): CartLine[] {
  return lines.filter((line) => !sameLine(line, target));
}

export function itemCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

// ---- Browser store (useSyncExternalStore) -------------------------------------------------

const EMPTY: CartLine[] = [];
let cache: { raw: string | null; lines: CartLine[] } = { raw: null, lines: EMPTY };
const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(CART_STORAGE_KEY);
  } catch {
    return null; // storage blocked (private mode, policy): the cart is simply empty
  }
}

export function getCartSnapshot(): CartLine[] {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, lines: parseCart(raw) };
  return cache.lines;
}

export function getServerCartSnapshot(): CartLine[] {
  return EMPTY;
}

export function subscribeCart(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === CART_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Writes the cart and notifies this tab. Returns false when the browser refused to store it. */
export function writeCart(lines: CartLine[]): boolean {
  let stored = true;
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
  } catch {
    stored = false;
  }
  for (const listener of listeners) listener();
  return stored;
}
