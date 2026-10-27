import Image from "next/image";
import { SizeRuler } from "@/components/size-ruler";
import { formatIdr } from "@/lib/format";
import type { ProductHit } from "@/lib/chat-api";

/**
 * Search results from the assistant. Each card shows only data the search returned:
 * photo, name, colour, IDR price, the sizes in stock and the terms that matched. There are
 * no ratings or stock counts.
 */
export function ProductHitList({ items }: { items: ProductHit[] }) {
  return (
    <ul aria-label="Hasil produk" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {items.map((product, index) => (
        <li key={product.external_id} className="min-w-0">
          <article
            aria-labelledby={`hit-${product.external_id}`}
            className="flex h-full flex-col rounded-card border border-border bg-surface p-1.5"
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-bay bg-stone">
              {product.image_path ? (
                <Image
                  src={product.image_path}
                  alt={product.image_alt ?? ""}
                  fill
                  loading={index < 2 ? "eager" : "lazy"}
                  sizes="(min-width: 640px) 320px, 90vw"
                  className="object-contain"
                />
              ) : (
                <p className="flex h-full items-center justify-center p-2 text-sm text-muted">Foto belum tersedia</p>
              )}
              <p data-price className="tabular absolute right-0 top-0 rounded-bl-bay bg-surface py-2 pl-3.5 pr-3 text-[17px] font-semibold text-text">
                {formatIdr(product.price_idr)}
              </p>
            </div>
            <div className="flex flex-1 flex-col gap-3 px-3 pb-3 pt-4">
              <div>
                <h3 id={`hit-${product.external_id}`} className="font-display break-words text-[22px] font-medium leading-tight text-text">
                  {product.name}
                </h3>
                {product.color ? <p className="mt-0.5 text-sm text-muted">Warna {product.color}</p> : null}
              </div>
              {product.sizes_in_stock.length > 0 ? (
                <div>
                  <p className="mb-1 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Ukuran tersedia (EU)</p>
                  <SizeRuler
                    label={`Ukuran tersedia ${product.name}`}
                    sizes={product.sizes_in_stock.map((size) => ({ size_eu: size, in_stock: true }))}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted">Tidak ada ukuran tersedia.</p>
              )}
              {product.matched_terms.length > 0 ? (
                <ul aria-label={`Cocok dengan: ${product.name}`} className="mt-auto flex flex-wrap gap-1.5">
                  {product.matched_terms.map((term) => (
                    <li key={term} className="inline-flex items-center gap-1.5 rounded-pill bg-stone px-2.5 py-1 text-[13px] text-text">
                      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-text" />
                      {term}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
