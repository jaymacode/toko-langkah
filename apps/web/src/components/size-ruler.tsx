/**
 * The EU size ruler: every size sits at its own position on a fixed EU 35–45 measuring scale.
 * In-stock sizes get a tall ink tick and numeral; sold-out sizes get a red tick, a struck numeral
 * AND the word "habis" (never colour alone); sizes the model is not made in stay as bare minor
 * ticks, so gaps read spatially. The decorative axis is aria-hidden; the list carries the meaning.
 *
 * With more than six sizes the marks sit too close for a word under each one, so the ruler goes
 * compact: smaller numerals, "habis" kept for screen readers, and one visible legend instead.
 */
const AXIS_MIN = 35;
const AXIS_MAX = 45;
const AXIS_SIZES = Array.from({ length: AXIS_MAX - AXIS_MIN + 1 }, (_, i) => AXIS_MIN + i);
const COMPACT_ABOVE = 6;

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
  const compact = sizes.length > COMPACT_ABOVE;
  const anySoldOut = sizes.some((size) => !size.in_stock);
  return (
    <div>
      <div className={`relative mx-3 ${compact ? "h-9" : "h-[4.25rem]"}`}>
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
                className={`mt-1 leading-none ${compact ? "text-[12px]" : "text-[15px]"} ${
                  size.in_stock ? "font-semibold text-text" : "text-muted line-through decoration-accent decoration-2"
                }`}
              >
                {size.size_eu}
              </span>
              {size.in_stock ? null : (
                <span
                  className={
                    compact
                      ? "sr-only"
                      : "mt-1 text-[10px] font-semibold uppercase leading-none tracking-wide text-accent-ink"
                  }
                >
                  habis
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      {compact && anySoldOut ? (
        <p aria-hidden="true" className="mt-1 flex items-center gap-1.5 text-[12px] text-muted">
          <span className="h-2 w-0.5 bg-accent" />
          Dicoret = habis
        </p>
      ) : null}
    </div>
  );
}
