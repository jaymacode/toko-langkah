import type { FilterChip } from "@/lib/chat";

/**
 * Active search filters. Each chip has a visible Indonesian label and a remove
 * button whose accessible name is "Hapus filter <label>". Removing a chip only
 * changes what the NEXT message sends; the parent shows the update hint.
 */
export function FilterChips({
  chips,
  onRemove,
}: {
  chips: FilterChip[];
  onRemove: (chip: FilterChip) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Filter aktif</p>
      <ul aria-label="Filter aktif" className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li
            key={chip.key}
            className="tabular flex min-h-11 items-center gap-0.5 rounded-pill bg-primary pl-4 text-[14px] font-medium text-on-primary"
          >
            <span>{chip.label}</span>
            <button
              type="button"
              onClick={() => onRemove(chip)}
              aria-label={chip.removeLabel}
              data-chip-key={chip.key}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-pill text-on-primary transition-colors duration-200 hover:bg-white/15 focus-visible:outline-offset-[-3px] focus-visible:outline-white"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
