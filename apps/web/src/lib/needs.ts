import type { Product } from "@/lib/api";

/**
 * Shopping "needs" (aisles). Membership comes only from each product's own tags in the
 * catalogue data, so an aisle never claims a shoe is suited to something the data does not say.
 */
export type NeedKey = "jalan-jauh" | "harian" | "trail";

export type Need = {
  key: NeedKey;
  label: string;
  /** Short line under the aisle name; describes the aisle, not a product promise. */
  blurb: string;
  tags: readonly string[];
};

export const NEEDS: readonly Need[] = [
  { key: "jalan-jauh", label: "Jalan jauh", blurb: "Bantalan untuk berjalan lama", tags: ["jalan jauh"] },
  { key: "harian", label: "Harian", blurb: "Santai untuk sehari-hari", tags: ["harian", "kasual"] },
  { key: "trail", label: "Trail", blurb: "Jalur tanah dan luar ruang", tags: ["trail"] },
];

export function isNeedKey(value: string | null | undefined): value is NeedKey {
  return NEEDS.some((need) => need.key === value);
}

export function needByKey(key: NeedKey): Need {
  const need = NEEDS.find((candidate) => candidate.key === key);
  if (!need) throw new RangeError(`unknown need ${key}`);
  return need;
}

export function matchesNeed(product: Product, key: NeedKey): boolean {
  const tags = product.tags.map((tag) => tag.toLowerCase());
  return needByKey(key).tags.some((tag) => tags.includes(tag));
}
