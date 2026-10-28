import Image from "next/image";
import Link from "next/link";
import { formatIdr } from "@/lib/format";
import type { Product } from "@/lib/api";
import { SizeRuler } from "@/components/size-ruler";

/**
 * One catalogue item. Availability is shown per size with the words "habis"
 * (sold out) and a strike-through, so it does not depend on colour alone.
 * Stock counts and ratings are intentionally never rendered. The name links to the product
 * page and its hit area is stretched over the whole card. Below 640px the card runs two to a
 * row, so the ruler (too tight at that width) gives way to a plain line of in-stock sizes.
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
  const inStock = product.sizes.filter((size) => size.in_stock).map((size) => size.size_eu);
  return (
    <article className="group relative flex h-full flex-col rounded-card border border-border bg-surface p-1.5 transition-shadow duration-300 ease-out-expo hover:shadow-[0_18px_40px_-24px_rgba(21,22,23,0.35)]">
      <div className="relative aspect-square w-full overflow-hidden rounded-bay bg-stone">
        {product.image_path ? (
          <Image
            src={product.image_path}
            alt={product.image_alt}
            fill
            loading={eager ? "eager" : "lazy"}
            sizes="(min-width: 1024px) 380px, 45vw"
            className="object-contain transition-transform duration-700 ease-out-expo group-hover:scale-[1.03]"
          />
        ) : (
          <p className="flex h-full items-center justify-center p-4 text-sm text-muted">
            Foto belum tersedia
          </p>
        )}
        <p data-price className="tabular absolute right-0 top-0 rounded-bl-bay bg-surface py-1.5 pl-2.5 pr-2 text-[14px] font-semibold text-text sm:py-2 sm:pl-3.5 sm:pr-3 sm:text-[17px]">
          {formatIdr(product.price_idr)}
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-3 px-2 pb-2 pt-3 sm:gap-4 sm:px-3 sm:pb-3 sm:pt-4">
        <div>
          <Heading className="font-display text-[18px] font-medium leading-tight text-text sm:text-[22px]">
            <Link
              href={`/produk/${product.slug}`}
              className="inline-flex min-h-11 items-center rounded-sm after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-[3px] focus-visible:after:outline-text"
            >
              {product.name}
            </Link>
          </Heading>
          {product.color ? <p className="mt-0.5 text-sm text-muted">Warna {product.color}</p> : null}
        </div>
        <div className="mt-auto">
          {inStock.length === 0 ? (
            <p className="mb-2 flex items-center gap-2 text-sm font-medium text-accent-ink">
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              Semua ukuran habis
            </p>
          ) : (
            <p className="tabular text-sm text-text sm:hidden">Ukuran {inStock.join(" · ")}</p>
          )}
          <div className="hidden sm:block">
            <p className="mb-1 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Ukuran EU</p>
            <SizeRuler label={`Ukuran ${product.name}`} sizes={product.sizes} />
          </div>
        </div>
      </div>
    </article>
  );
}
