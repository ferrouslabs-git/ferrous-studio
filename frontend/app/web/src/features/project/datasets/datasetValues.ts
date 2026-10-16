// How a dataset's values are read from what a person typed (FS-REQ-63).
//
// Every editor offers one value per line, but a list pasted from elsewhere
// often arrives as a single comma-separated line ("1 Mar 2026, 8 Mar 2026,
// ..."). Stored as one value, the whole line then fills every list cell.
// So a single line is split on its commas; several lines are taken a line
// at a time, because then commas are part of the values ("12 High Street,
// Leeds").

/** The values in an editor's text: one per line, or comma-separated when it
 *  is all on one line. Blanks are dropped. */
export function parseDatasetValues(text: string): string[] {
  const lines = text.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
  return normaliseDatasetValues(lines);
}

/** A stored value list as elements should use it: a dataset saved as one
 *  comma-joined value (before the editors split single lines) reads as the
 *  separate values it stands for. Lists of two or more are left alone. */
export function normaliseDatasetValues(values: readonly string[]): string[] {
  if (values.length === 1 && values[0].includes(",")) {
    return values[0].split(",").map((v) => v.trim()).filter(Boolean);
  }
  return [...values];
}
