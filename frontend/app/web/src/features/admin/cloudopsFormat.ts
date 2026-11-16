// Small, pure helpers for the CloudOps costs page, kept out of the component so they can be tested alone.
import { DailyAmount } from "./cloudopsApi";

/** 1234.5 -> "$1,234.50"; negatives read "-$33.29" so credits are unmistakable. */
export function usd(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

/** An amount's share of a total, as "42%"; "—" when there is no total to compare against. */
export function share(amount: number, total: number): string {
  if (!(total > 0)) return "—";
  const pct = (amount / total) * 100;
  return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

/** Bar heights (0 to 1) for a daily series, scaled to the biggest day across every series passed in. */
export function barHeights(series: DailyAmount[], max: number): number[] {
  if (!(max > 0)) return series.map(() => 0);
  return series.map((d) => Math.max(0, Math.min(1, d.amount / max)));
}

export function peak(...series: DailyAmount[][]): number {
  return Math.max(0, ...series.flat().map((d) => d.amount));
}

/** "2026-11-16" -> "16 Nov". */
export function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${names[m - 1]}`;
}
