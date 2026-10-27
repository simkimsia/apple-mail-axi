import { encode } from "@toon-format/toon";

export { encode };

/** Render a labeled list of already-flattened rows as TOON. */
export function renderList(
  label: string,
  rows: Record<string, unknown>[],
): string {
  return encode({ [label]: rows });
}

/** Render help suggestions (manual formatting — encode() inlines primitive arrays). */
export function renderHelp(lines: string[]): string {
  if (lines.length === 0) return "";
  const indented = lines.map((l) => `  ${l}`).join("\n");
  return `help[${lines.length}]:\n${indented}`;
}

/** Combine multiple TOON blocks into a single output string. */
export function renderOutput(blocks: string[]): string {
  return blocks.filter(Boolean).join("\n");
}

/**
 * Size-aware truncation (AXI principle 3), ported from calcom-axi. Collapses
 * newlines, and when a value exceeds `max` keeps the head plus a size hint
 * ("… (312 chars)") so the agent knows what it is missing. `full` disables
 * the cap. Use one Truncator per render so the renderer can add a single
 * `--full` hint when anything was actually cut.
 */
export class Truncator {
  /** Number of values that were cut in this render. */
  count = 0;

  constructor(private readonly full = false) {}

  cut(text: string, max: number): string {
    const oneLine = text.replace(/\s*\n\s*/g, " ⏎ ");
    if (this.full || oneLine.length <= max) return oneLine;
    this.count++;
    return `${oneLine.slice(0, max)}… (${oneLine.length} chars)`;
  }
}
