import Image from "next/image";
import { formatIdr } from "@/lib/format";
import type { Product } from "@/lib/api";

/**
 * One catalogue item. Availability is shown per size with the words "habis"
 * (sold out) and a strike-through, so it does not depend on colour alone.
 * Stock counts and ratings are intentionally never rendered.
 */
export function ProductCard({
  product,
  headingLevel = 3,
  eager = false,
}: {
  product: Product;
  headingLevel?: 2 | 3;
  /** Load the photo eagerly for cards above the fold (avoids a lazy LCP image). */
  eager?: boolean;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface">
      <div className="relative aspect-square w-full bg-background">
        {product.image_path ? (
          <Image
            src={product.image_path}
            alt={product.image_alt}
            fill
            loading={eager ? "eager" : "lazy"}
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 45vw, 90vw"
            className="object-contain p-4"
          />
        ) : (
          <p className="flex h-full items-center justify-center p-4 text-sm text-muted">
            Foto belum tersedia
          </p>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <Heading className="text-lg font-semibold text-text">{product.name}</Heading>
          {product.color ? <p className="mt-1 text-sm text-muted">Warna {product.color}</p> : null}
        </div>
        <p className="text-lg font-semibold text-text">{formatIdr(product.price_idr)}</p>
        <div>
          <p className="text-sm text-muted">Ukuran EU</p>
          <ul className="mt-2 flex flex-wrap gap-2" aria-label={`Ukuran ${product.name}`}>
            {product.sizes.map((size) => (
              <li
                key={size.size_eu}
                className={
                  size.in_stock
                    ? "flex min-h-11 min-w-11 flex-col items-center justify-center rounded-card border border-border px-2 text-text"
                    : "flex min-h-11 min-w-11 flex-col items-center justify-center rounded-card border border-dashed border-border bg-background px-2 text-muted"
                }
              >
                <span className={size.in_stock ? "" : "line-through"}>{size.size_eu}</span>
                {size.in_stock ? null : <span className="text-xs">habis</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}
