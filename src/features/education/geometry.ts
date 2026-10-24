export function domainOf(points: { x: number; y: number }[], pad = 0.12): [number, number, number, number] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [xmin, xmax, ymin, ymax] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const px = (xmax - xmin || 1) * pad;
  const py = (ymax - ymin || 1) * pad;
  return [xmin - px, xmax + px, ymin - py, ymax + py];
}
