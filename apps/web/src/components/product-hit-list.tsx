import Image from "next/image";
import { formatIdr } from "@/lib/format";
import type { ProductHit } from "@/lib/chat-api";

/**
 * Search results from the assistant. Each card shows only data the search returned:
 * photo, name, colour, IDR price, the sizes in stock and the terms that matched. There are
 * no ratings or stock counts.
 */
export function ProductHitList({ items }: { items: ProductHit[] }) {
  return (
    <ul aria-label="Hasil produk" className="flex flex-col gap-4">
      {items.map((product) => (
        <li key={product.external_id} className="min-w-0">
          <article
            aria-labelledby={`hit-${product.external_id}`}
            className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
          >
            <div className="relative aspect-square w-full max-w-48 rounded-card bg-background">
              {product.image_path ? (
                <Image
                  src={product.image_path}
                  alt={product.image_alt ?? ""}
                  fill
                  sizes="192px"
                  className="object-contain p-2"
                />
              ) : (
                <p className="flex h-full items-center justify-center p-2 text-sm text-muted">Foto belum tersedia</p>
              )}
            </div>
            <h3 id={`hit-${product.external_id}`} className="break-words text-lg font-semibold text-text">
              {product.name}
            </h3>
            {product.color ? <p className="text-sm text-muted">Warna {product.color}</p> : null}
            <p className="text-lg font-semibold text-text">{formatIdr(product.price_idr)}</p>
            {product.sizes_in_stock.length > 0 ? (
              <p className="text-sm text-text">Ukuran tersedia (EU): {product.sizes_in_stock.join(", ")}</p>
            ) : (
              <p className="text-sm text-muted">Tidak ada ukuran tersedia.</p>
            )}
            {product.matched_terms.length > 0 ? (
              <p className="text-sm text-muted">Cocok dengan: {product.matched_terms.join(", ")}</p>
            ) : null}
          </article>
        </li>
      ))}
    </ul>
  );
}
