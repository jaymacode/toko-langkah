import Image from "next/image";
import { formatIdr } from "@/lib/format";
import type { Product } from "@/lib/api";
import { SizeRuler } from "@/components/size-ruler";

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
    <article className="group flex h-full flex-col rounded-card border border-border bg-surface p-1.5 transition-shadow duration-300 ease-out-expo hover:shadow-[0_18px_40px_-24px_rgba(21,22,23,0.35)]">
      <div className="relative aspect-square w-full overflow-hidden rounded-bay bg-stone">
        {product.image_path ? (
          <Image
            src={product.image_path}
            alt={product.image_alt}
            fill
            loading={eager ? "eager" : "lazy"}
            sizes="(min-width: 1024px) 380px, (min-width: 640px) 45vw, 90vw"
            className="object-contain transition-transform duration-700 ease-out-expo group-hover:scale-[1.03]"
          />
        ) : (
          <p className="flex h-full items-center justify-center p-4 text-sm text-muted">
            Foto belum tersedia
          </p>
        )}
        <p data-price className="tabular absolute right-0 top-0 rounded-bl-bay bg-surface py-2 pl-3.5 pr-3 text-[17px] font-semibold text-text">
          {formatIdr(product.price_idr)}
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-4 px-3 pb-3 pt-4">
        <div>
          <Heading className="font-display text-[22px] font-medium leading-tight text-text">{product.name}</Heading>
          {product.color ? <p className="mt-0.5 text-sm text-muted">Warna {product.color}</p> : null}
        </div>
        <div className="mt-auto">
          <p className="mb-1 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Ukuran EU</p>
          <SizeRuler label={`Ukuran ${product.name}`} sizes={product.sizes} />
        </div>
      </div>
    </article>
  );
}
