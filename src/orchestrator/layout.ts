import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The most common way a generated shot goes wrong is not that it crashes: it is that the drawing sits in
 * a corner (e.g. around x=640 instead of x=960), or keyframes fire after `len` so only the background
 * radial gradient of `<Schematic>` is visible. We downscale each still to a 64x36 grey grid and detect
 * actual drawn features (local edge contrast or bright ink), ignoring smooth background vignette gradients.
 */
export async function inkBox(
  file: string,
): Promise<{ x0: number; x1: number; y0: number; y1: number; fill: number; leftFill: number; rightFill: number } | null> {
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
    let x0 = w;
    let x1 = -1;
    let y0 = h;
    let y1 = -1;
    let count = 0;
    let left = 0;
    let right = 0;
    // Skip 2px border (corner registration marks in Schematic live near the frame edges)
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const grad = Math.abs(px(x, y) - px(x - 1, y)) + Math.abs(px(x, y) - px(x, y - 1));
        if (grad <= 14 && px(x, y) <= 80) continue;
        count++;
        if (x < w / 2) left++;
        else right++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    const totalCells = (w - 4) * (h - 4);
    const halfCells = totalCells / 2;
    if (x1 < 0) return { x0: 0, x1: 0, y0: 0, y1: 0, fill: 0, leftFill: 0, rightFill: 0 };
    return {
      x0: x0 / w,
      x1: (x1 + 1) / w,
      y0: y0 / h,
      y1: (y1 + 1) / h,
      fill: count / totalCells,
      leftFill: left / halfCells,
      rightFill: right / halfCells,
    };
  } catch {
    return null;
  }
}

/** One line per still: where the ink is, a warning when sparse, EMPTY when blank or half-dead (blocks the pipeline). */
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
  const failedIds: string[] = [];
  for (const name of names) {
    const box = await inkBox(path.join(dir, name));
    if (!box) continue;
    const id = name.replace(/\.png$/i, '');
    lines.push(
      `${id}: ink x ${box.x0.toFixed(2)}-${box.x1.toFixed(2)}, y ${box.y0.toFixed(2)}-${box.y1.toFixed(2)}, covers ${(box.fill * 100).toFixed(0)}% (L ${(box.leftFill * 100).toFixed(0)}% / R ${(box.rightFill * 100).toFixed(0)}%)`,
    );
    if (box.fill < 0.06) {
      failedIds.push(id);
      empty.push(
        `${id} is nearly blank (${(box.fill * 100).toFixed(1)}% ink): check that keyframes fire before the shot's key/len (t is in frames, not seconds) and camera zoom is 1.0–2.4`,
      );
    } else if (box.x1 - box.x0 < 0.35) {
      failedIds.push(id);
      empty.push(`${id} only spans x ${box.x0.toFixed(2)}-${box.x1.toFixed(2)}: drawing is crushed into a strip`);
    } else if (box.x1 < 0.65 || box.rightFill < 0.04) {
      failedIds.push(id);
      empty.push(
        `${id} leaves the right half dead (x ends at ${box.x1.toFixed(2)}, right ink ${(box.rightFill * 100).toFixed(0)}%): centre elements around x=960 (1920x1080 canvas), not x=640`,
      );
    } else if (box.x0 > 0.35 || box.leftFill < 0.04) {
      failedIds.push(id);
      empty.push(
        `${id} leaves the left half dead (x starts at ${box.x0.toFixed(2)}, left ink ${(box.leftFill * 100).toFixed(0)}%): centre elements around x=960`,
      );
    } else if (box.fill < 0.12) {
      warn.push(`${id} is sparse (${(box.fill * 100).toFixed(0)}% ink): add props, labels or a closer framing`);
    }
  }
  if (!lines.length) return '';
  return `layout (measured on the stills):\n${lines.join('\n')}${warn.length ? `\nWARNING: ${warn.join('; ')}` : ''}${
    empty.length ? `\nEMPTY: ${empty.join('; ')}\nFAILED_SHOTS: ${failedIds.join(', ')}` : ''
  }`;
}
