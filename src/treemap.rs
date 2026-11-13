//! Squarified treemap layout (Bruls, Huizing, van Wijk).
//! `values` must be positive and sorted descending for best results.

use eframe::egui::{pos2, vec2, Rect};

pub fn layout(values: &[f64], rect: Rect) -> Vec<Rect> {
    let mut out = vec![Rect::NOTHING; values.len()];
    let total: f64 = values.iter().sum();
    if total <= 0.0 || rect.width() <= 0.0 || rect.height() <= 0.0 {
        return out;
    }
    let scale = rect.width() as f64 * rect.height() as f64 / total;
    let areas: Vec<f64> = values.iter().map(|v| v * scale).collect();

    let mut r = rect;
    let mut i = 0;
    while i < areas.len() {
        let short = (r.width().min(r.height()) as f64).max(1e-6);
        let mut j = i + 1;
        let mut best = worst(&areas[i..j], short);
        while j < areas.len() {
            let w = worst(&areas[i..=j], short);
            if w <= best {
                best = w;
                j += 1;
            } else {
                break;
            }
        }
        let row = &areas[i..j];
        let row_sum: f64 = row.iter().sum();
        let last = j == areas.len();

        if r.width() >= r.height() {
            // Column along the left edge.
            let col_w = if last { r.width() } else { (row_sum / r.height() as f64) as f32 };
            let mut y = r.top();
            for (k, a) in row.iter().enumerate() {
                let h = if k + 1 == row.len() { r.bottom() - y } else { (*a / col_w as f64) as f32 };
                out[i + k] = Rect::from_min_size(pos2(r.left(), y), vec2(col_w, h));
                y += h;
            }
            r.min.x += col_w;
        } else {
            // Row along the top edge.
            let row_h = if last { r.height() } else { (row_sum / r.width() as f64) as f32 };
            let mut x = r.left();
            for (k, a) in row.iter().enumerate() {
                let w = if k + 1 == row.len() { r.right() - x } else { (*a / row_h as f64) as f32 };
                out[i + k] = Rect::from_min_size(pos2(x, r.top()), vec2(w, row_h));
                x += w;
            }
            r.min.y += row_h;
        }
        i = j;
    }
    out
}

fn worst(row: &[f64], side: f64) -> f64 {
    let s: f64 = row.iter().sum();
    let max = row.iter().cloned().fold(f64::MIN, f64::max);
    let min = row.iter().cloned().fold(f64::MAX, f64::min);
    if min <= 0.0 || s <= 0.0 {
        return f64::INFINITY;
    }
    let s2 = s * s;
    let w2 = side * side;
    (w2 * max / s2).max(s2 / (w2 * min))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn areas_fill_rect() {
        let rect = Rect::from_min_size(pos2(0.0, 0.0), vec2(600.0, 400.0));
        let vals = [6.0, 6.0, 4.0, 3.0, 2.0, 2.0, 1.0];
        let rects = layout(&vals, rect);
        let total: f32 = rects.iter().map(|r| r.area()).sum();
        assert!((total - rect.area()).abs() < 1.0, "{total}");
        for r in &rects {
            assert!(rect.expand(0.01).contains_rect(*r));
        }
    }
}
