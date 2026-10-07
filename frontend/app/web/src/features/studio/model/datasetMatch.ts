// Picking a dataset for an element from its label (FS-REQ-44): a dropdown
// labelled "Industry" should arrive bound to the Industries list without the
// user hunting for it. Pure functions — no React, no network.
//
// Matching is on singularised words, so "Industry" ↔ "Industries", "City" ↔
// "UK cities" and "Job title" ↔ "Job titles" all meet. A guess is only made
// when it is unambiguous: "Status" sits equally well with "Order statuses"
// and "Record status", so it gets neither.

/** What matching needs to know about a dataset. */
export interface DatasetRef {
  id: string;
  name: string;
  scope?: "platform" | "project" | string;
}

const IRREGULAR: Record<string, string> = {
  people: "person",
  children: "child",
  men: "man",
  women: "woman",
  data: "data",
  news: "news",
  series: "series",
  analyses: "analysis",
};

/** One word's singular form, by English's regular plural endings. Good
 *  enough for labels and list names; not a general inflector. */
export function singular(word: string): string {
  const w = word.toLowerCase();
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(sses|uses|xes|ches|shes|zzes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** A label or name as singular lower-case words, punctuation dropped. */
export const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular);

/** How well a dataset's name fits a label: 3 the same words, 2 the same
 *  head noun (last word) with every label word in the name, 1 every label
 *  word in the name, 0 no fit. */
export function matchScore(label: string, datasetName: string): number {
  const l = words(label);
  const d = words(datasetName);
  if (!l.length || !d.length) return 0;
  if (l.join(" ") === d.join(" ")) return 3;
  if (!l.every((w) => d.includes(w))) return 0;
  return l[l.length - 1] === d[d.length - 1] ? 2 : 1;
}

/** The dataset `label` most plainly names, or null when none does or the
 *  best fit is shared. A project's own list beats a platform default of the
 *  same fit — the team made it for this project. */
export function suggestDataset(label: string, datasets: readonly DatasetRef[]): DatasetRef | null {
  let best: DatasetRef[] = [];
  let bestRank = 0;
  for (const ds of datasets) {
    const score = matchScore(label, ds.name);
    if (!score) continue;
    const rank = score * 2 + (ds.scope === "project" ? 1 : 0);
    if (rank > bestRank) {
      best = [ds];
      bestRank = rank;
    } else if (rank === bestRank) {
      best.push(ds);
    }
  }
  return best.length === 1 ? best[0] : null;
}
