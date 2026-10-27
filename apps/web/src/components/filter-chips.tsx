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
      <p className="text-sm font-semibold text-text">Filter aktif</p>
      <ul aria-label="Filter aktif" className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li
            key={chip.key}
            className="flex min-h-11 items-center gap-1 rounded-card border border-border bg-background pl-3 text-sm text-text"
          >
            <span>{chip.label}</span>
            <button
              type="button"
              onClick={() => onRemove(chip)}
              aria-label={chip.removeLabel}
              data-chip-key={chip.key}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-card px-2 text-text hover:bg-surface"
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
