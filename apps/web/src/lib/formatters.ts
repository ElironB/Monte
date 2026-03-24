export const integerFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

export const compactFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  notation: 'compact',
});

export const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});

export function formatDate(value: string | undefined) {
  if (!value) return 'n/a';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatDurationMs(value: number | undefined) {
  if (!value && value !== 0) return 'n/a';
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;

  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function formatPercentFromRatio(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return 'n/a';
  return percentFormatter.format(value);
}

export function formatTooltipNumber(value: unknown, formatter: (numeric: number) => string) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? formatter(numeric) : 'n/a';
}

export function titleCase(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
