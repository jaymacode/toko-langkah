/**
 * The EU size ruler: every size sits at its own position on a fixed EU 36–46 measuring scale.
 * In-stock sizes get a tall ink tick and numeral; sold-out sizes get a red tick, a struck numeral
 * AND the word "habis" (never colour alone); sizes the model is not made in stay as bare minor
 * ticks, so gaps read spatially. The decorative axis is aria-hidden; the list carries the meaning.
 */
const AXIS_MIN = 36;
const AXIS_MAX = 46;
const AXIS_SIZES = Array.from({ length: AXIS_MAX - AXIS_MIN + 1 }, (_, i) => AXIS_MIN + i);

function position(size: number): string {
  const clamped = Math.min(AXIS_MAX, Math.max(AXIS_MIN, size));
  return `${((clamped - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * 100}%`;
}

export function SizeRuler({
  label,
  sizes,
}: {
  /** Accessible name of the list, e.g. "Ukuran Langkah Knit". */
  label: string;
  sizes: { size_eu: number; in_stock: boolean }[];
}) {
  return (
    <div className="relative mx-3 h-[4.25rem]">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 border-t border-text">
        {AXIS_SIZES.map((size) => (
          <span key={size} className="absolute top-0 h-1.5 w-px -translate-x-1/2 bg-quiet" style={{ left: position(size) }} />
        ))}
      </div>
      <ul aria-label={label} className="absolute inset-0">
        {sizes.map((size) => (
          <li
            key={size.size_eu}
            className="tabular absolute top-0 flex -translate-x-1/2 flex-col items-center"
            style={{ left: position(size.size_eu) }}
          >
            <span
              aria-hidden="true"
              className={size.in_stock ? "h-3.5 w-0.5 bg-text" : "h-2.5 w-0.5 bg-accent"}
            />
            <span
              className={
                size.in_stock
                  ? "mt-1 text-[15px] font-semibold leading-none text-text"
                  : "mt-1 text-[15px] leading-none text-muted line-through decoration-accent decoration-2"
              }
            >
              {size.size_eu}
            </span>
            {size.in_stock ? null : (
              <span className="mt-1 text-[10px] font-semibold uppercase leading-none tracking-wide text-accent-ink">habis</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
