const idrFormatter = new Intl.NumberFormat("id-ID", {
  style: "decimal",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/**
 * Formats an integer IDR amount for display, e.g. 449000 -> "Rp 449.000".
 * Prices are whole rupiah; fractional or unsafe values are rejected.
 */
export function formatIdr(amount: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`formatIdr expects a safe integer, received ${String(amount)}`);
  }
  return `Rp ${idrFormatter.format(amount)}`;
}

const dateTimeFormatter = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

/** Formats an ISO timestamp in Indonesian, e.g. "27 Okt 2026, 21.30" (WIB). */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`formatDateTime expects an ISO timestamp, received ${iso}`);
  }
  return dateTimeFormatter.format(date);
}
