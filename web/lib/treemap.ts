export type Rect = { x: number; y: number; w: number; h: number };

/** Squarified treemap, matching src/treemap.rs. Values should be positive. */
export function treemap(values: number[], width: number, height: number): Rect[] {
  const out: Rect[] = values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || width <= 0 || height <= 0) return out;

  const scale = (width * height) / total;
  const areas = values.map((value) => value * scale);
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let i = 0;

  while (i < areas.length) {
    const side = Math.max(Math.min(w, h), 1e-6);
    let j = i + 1;
    let best = worst(areas.slice(i, j), side);
    while (j < areas.length) {
      const next = worst(areas.slice(i, j + 1), side);
      if (next <= best) {
        best = next;
        j += 1;
      } else {
        break;
      }
    }

    const row = areas.slice(i, j);
    const rowSum = row.reduce((sum, area) => sum + area, 0);
    const last = j === areas.length;

    if (w >= h) {
      const colW = last ? w : rowSum / h;
      let yy = y;
      row.forEach((area, k) => {
        const rh = k + 1 === row.length ? y + h - yy : area / colW;
        out[i + k] = { x, y: yy, w: colW, h: rh };
        yy += rh;
      });
      x += colW;
      w -= colW;
    } else {
      const rowH = last ? h : rowSum / w;
      let xx = x;
      row.forEach((area, k) => {
        const rw = k + 1 === row.length ? x + w - xx : area / rowH;
        out[i + k] = { x: xx, y, w: rw, h: rowH };
        xx += rw;
      });
      y += rowH;
      h -= rowH;
    }
    i = j;
  }

  return out;
}

function worst(row: number[], side: number): number {
  if (row.length === 0) return Number.POSITIVE_INFINITY;
  const sum = row.reduce((total, value) => total + value, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  if (min <= 0 || sum <= 0) return Number.POSITIVE_INFINITY;
  const sum2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / sum2, sum2 / (side2 * min));
}
