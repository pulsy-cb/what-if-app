import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The most common way a generated shot goes wrong is not that it crashes: it is that the drawing sits in
 * a corner and the rest of the 1920x1080 frame stays empty. Nobody catches that from a tool log, so we
 * measure it: downscale the still to a 64x36 grey grid and report where the ink actually is.
 */
export async function inkBox(file: string): Promise<{ x0: number; x1: number; y0: number; y1: number; fill: number } | null> {
  if (!fs.existsSync(file)) return null;
  try {
    const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=64:36,format=gray', '-f', 'rawvideo', '-'], {
      encoding: 'buffer',
      maxBuffer: 4 * 1024 * 1024,
    });
    const w = 64;
    const h = 36;
    if (stdout.length < w * h) return null;
    const px = (x: number, y: number) => stdout[y * w + x]!;
    // the background is whatever dominates the border: anything farther than a tolerance from it is ink
    const border: number[] = [];
    for (let x = 0; x < w; x++) border.push(px(x, 0), px(x, h - 1));
    for (let y = 0; y < h; y++) border.push(px(0, y), px(w - 1, y));
    const bg = border.sort((a, b) => a - b)[Math.floor(border.length / 2)]!;
    // faint background grids must not count as ink: only real contrast does
    const tol = 20;
    let x0 = w;
    let x1 = -1;
    let y0 = h;
    let y1 = -1;
    let count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (Math.abs(px(x, y) - bg) <= tol) continue;
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return { x0: 0, x1: 0, y0: 0, y1: 0, fill: 0 };
    return { x0: x0 / w, x1: (x1 + 1) / w, y0: y0 / h, y1: (y1 + 1) / h, fill: count / (w * h) };
  } catch {
    return null;
  }
}

/** One line per still: where the ink is, a warning when the frame is lopsided, EMPTY when nothing is drawn. */
export async function layoutReport(dir: string): Promise<string> {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => /\.png$/i.test(n)).sort();
  } catch {
    return '';
  }
  const lines: string[] = [];
  const warn: string[] = [];
  const empty: string[] = [];
  for (const name of names) {
    const box = await inkBox(path.join(dir, name));
    if (!box) continue;
    const id = name.replace(/\.png$/i, '');
    lines.push(`${id}: ink x ${box.x0.toFixed(2)}-${box.x1.toFixed(2)}, y ${box.y0.toFixed(2)}-${box.y1.toFixed(2)}, covers ${(box.fill * 100).toFixed(0)}%`);
    if (box.fill < 0.03) empty.push(`${id} is empty (${(box.fill * 100).toFixed(1)}% of the frame has ink)`);
    else if (box.x1 - box.x0 < 0.3) empty.push(`${id} only spans x ${box.x0.toFixed(2)}-${box.x1.toFixed(2)}: almost nothing is drawn`);
    else if (box.x1 - box.x0 < 0.55 && box.fill < 0.22) warn.push(`${id} is sparse (${(box.fill * 100).toFixed(0)}% ink, x ${box.x0.toFixed(2)}-${box.x1.toFixed(2)}): deliberate?`);
    else if (box.x1 < 0.6) warn.push(`${id}: nothing after x=${box.x1.toFixed(2)} — half the frame is dead, centre the drawing or widen the set`);
    else if (box.x0 > 0.4) warn.push(`${id}: nothing before x=${box.x0.toFixed(2)} — the left half is dead`);
    else if (box.x1 - box.x0 < 0.4) warn.push(`${id}: the drawing only spans x ${box.x0.toFixed(2)}-${box.x1.toFixed(2)} of the frame`);
  }
  if (!lines.length) return '';
  return `layout (measured on the stills):\n${lines.join('\n')}${warn.length ? `\nWARNING: ${warn.join('; ')}` : ''}${
    empty.length ? `\nEMPTY: ${empty.join('; ')}` : ''
  }`;
}
