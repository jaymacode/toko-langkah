"use client";

import type { ProductSize } from "@/lib/api";

/**
 * The size ruler as a control. The scale spans one size either side of the model's range, so
 * marks sit far enough apart for 44px targets even on a 360px phone. Each size is a native
 * radio: in-stock sizes are selectable; sold-out sizes are disabled, struck through and say
 * "habis" (never colour alone). The decorative axis is aria-hidden; the fieldset carries meaning.
 */
export function SizePicker({
  name,
  legend,
  sizes,
  value,
  onChange,
  describedBy,
}: {
  name: string;
  legend: string;
  sizes: ProductSize[];
  value: number | null;
  onChange: (size: number) => void;
  describedBy?: string;
}) {
  const sorted = [...sizes].sort((a, b) => a.size_eu - b.size_eu);
  if (sorted.length === 0) return null;
  const min = (sorted[0]?.size_eu ?? 0) - 1;
  const max = (sorted[sorted.length - 1]?.size_eu ?? 0) + 1;
  const span = Math.max(1, max - min);
  const ticks = Array.from({ length: span + 1 }, (_, i) => min + i);
  // Past six steps the marks would crowd below 44px on a phone, so the scale becomes a wrapping row.
  const onScale = span <= 6;
  const left = (size: number) => `${((size - min) / span) * 100}%`;

  return (
    <fieldset aria-describedby={describedBy} className="min-w-0">
      <legend className="mb-3 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{legend}</legend>
      <div className={onScale ? "relative mx-6 h-[6.5rem]" : "flex flex-wrap gap-x-2 gap-y-3 border-t-2 border-text pt-0"}>
        <div aria-hidden="true" className={onScale ? "absolute inset-x-0 top-0 border-t-2 border-text" : "hidden"}>
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute top-0 h-2 w-px -translate-x-1/2 bg-quiet"
              style={{ left: left(tick) }}
            />
          ))}
        </div>
        {sorted.map((size) => {
          const selected = value === size.size_eu;
          return (
            <label
              key={size.size_eu}
              className={`flex flex-col items-center ${onScale ? "absolute top-0 -translate-x-1/2" : ""} ${size.in_stock ? "cursor-pointer" : "cursor-not-allowed"}`}
              style={onScale ? { left: left(size.size_eu) } : undefined}
            >
              <input
                type="radio"
                name={name}
                value={size.size_eu}
                checked={selected}
                disabled={!size.in_stock}
                onChange={() => onChange(size.size_eu)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={size.in_stock ? "h-4 w-0.5 bg-text" : "h-2.5 w-0.5 bg-accent"}
              />
              <span
                className={`tabular mt-1.5 inline-flex h-11 min-w-11 items-center justify-center rounded-pill px-2 text-[17px] transition-colors duration-200 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-text ${
                  !size.in_stock
                    ? "text-muted line-through decoration-accent decoration-2"
                    : selected
                      ? "bg-primary font-semibold text-on-primary"
                      : "border border-rule bg-surface font-semibold text-text hover:border-text"
                }`}
              >
                {size.size_eu}
              </span>
              {size.in_stock ? null : (
                <span className="mt-1 text-[11px] font-semibold uppercase leading-none tracking-wide text-accent-ink">habis</span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
