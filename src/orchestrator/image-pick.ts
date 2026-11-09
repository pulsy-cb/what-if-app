import path from 'node:path';

const natural = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });
const stem = (p: string): string => path.basename(p).replace(/\.[^.]+$/, '');

/**
 * Which of the images a tool just produced the model gets to see on its next step (at most `max`).
 * The old behaviour was the first three in alphabetical order, so a 36-shot board always showed S1, S10, S11.
 * Now: the shots it asked to re-render, else the readable contact sheets, else an even spread across the episode.
 */
export function pickImages(paths: string[], shotIds: string[] = [], max = 3): string[] {
  const unique = [...new Set(paths)].sort(natural);
  if (unique.length <= max) return unique;

  const wanted = shotIds.map((s) => s.toUpperCase());
  const requested = wanted.flatMap((id) => unique.filter((p) => stem(p).toUpperCase() === id));
  if (requested.length) return [...new Set(requested)].slice(0, max);

  const sheets = unique.filter((p) => /(^|\/)sheets\/sheet-\d+\.jpe?g$/i.test(p));
  if (sheets.length) return sheets.slice(0, max);

  // an even spread (first, middle, last...) instead of the three first names; the tall storyboard strip is last resort
  const stills = unique.filter((p) => !/(^|\/)storyboard\.jpe?g$/i.test(p));
  const pool = stills.length >= max ? stills : unique;
  return Array.from({ length: max }, (_, i) => pool[Math.round((i * (pool.length - 1)) / (max - 1))]!);
}
