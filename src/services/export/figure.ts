import type { ColorMapping } from '@/visualization/common/colorMapping';
import { formatTick, niceTicks } from '@/visualization/common/geometry';
import { MARKER_SHAPES, rgbToHex } from '@/visualization/common/palettes';

export interface FigureOptions {
  width: number;
  height: number;
  background: string | null;
  foreground: string;
  title: string;
  subtitle: string;
  xLabel: string;
  yLabel: string;
  showAxes: boolean;
  showGrid: boolean;
  legend: 'right' | 'none';
  fontSize: number;
  pointSize: number;
  opacity: number;
  shapes: boolean;
  highlightSelection: boolean;
  caption: string | null;
  /** Data window; null fits all visible points. */
  viewport: { xmin: number; xmax: number; ymin: number; ymax: number } | null;
}

export interface FigureData {
  /** N × 2 coordinates (2D projections only). */
  coords: Float32Array;
  rowIndices: Uint32Array | null;
  mapping: ColorMapping;
  hidden: Uint8Array | null;
  selection: Set<number>;
}

interface Layout {
  plot: { x: number; y: number; w: number; h: number };
  sx: (v: number) => number;
  sy: (v: number) => number;
  xt: number[];
  yt: number[];
  legendX: number;
  domain: { xmin: number; xmax: number; ymin: number; ymax: number };
}

const MUTED = (fg: string) =>
  fg.toLowerCase() === '#ffffff' || fg.toLowerCase() === '#f4f7fb' ? '#9ca9bc' : '#5b6475';

/** Computes plot geometry with equal data aspect ratio (distances look the same along both axes). */
function layout(data: FigureData, o: FigureOptions): Layout {
  const f = o.fontSize;
  const legendWidth =
    o.legend === 'right' && data.mapping.mode !== 'uniform' ? Math.min(220, Math.max(120, o.width * 0.2)) : 0;
  const top = (o.title ? f * 2.2 : f * 0.8) + (o.subtitle ? f * 1.4 : 0);
  const bottom = (o.showAxes ? f * 3.2 : f) + (o.caption ? f * 2.4 : 0);
  const left = o.showAxes ? f * 4.2 : f;
  const right = f + legendWidth;
  const plot = {
    x: left,
    y: top,
    w: Math.max(40, o.width - left - right),
    h: Math.max(40, o.height - top - bottom),
  };

  let { xmin, xmax, ymin, ymax } = o.viewport ?? {
    xmin: Infinity,
    xmax: -Infinity,
    ymin: Infinity,
    ymax: -Infinity,
  };
  if (!o.viewport) {
    const count = data.coords.length / 2;
    for (let r = 0; r < count; r++) {
      const row = data.rowIndices ? data.rowIndices[r]! : r;
      if (data.hidden && data.hidden[row]) continue;
      const x = data.coords[r * 2]!;
      const y = data.coords[r * 2 + 1]!;
      xmin = Math.min(xmin, x);
      xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y);
      ymax = Math.max(ymax, y);
    }
    if (!Number.isFinite(xmin)) [xmin, xmax, ymin, ymax] = [-1, 1, -1, 1];
    const padX = (xmax - xmin || 1) * 0.05;
    const padY = (ymax - ymin || 1) * 0.05;
    xmin -= padX;
    xmax += padX;
    ymin -= padY;
    ymax += padY;
  }
  // Equal aspect: widen the tighter axis around its centre.
  const unitsPerPx = Math.max((xmax - xmin) / plot.w, (ymax - ymin) / plot.h);
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  xmin = cx - (unitsPerPx * plot.w) / 2;
  xmax = cx + (unitsPerPx * plot.w) / 2;
  ymin = cy - (unitsPerPx * plot.h) / 2;
  ymax = cy + (unitsPerPx * plot.h) / 2;
  return {
    plot,
    sx: (v) => plot.x + ((v - xmin) / (xmax - xmin)) * plot.w,
    sy: (v) => plot.y + plot.h - ((v - ymin) / (ymax - ymin)) * plot.h,
    xt: niceTicks(xmin, xmax, Math.max(3, Math.round(plot.w / 110))),
    yt: niceTicks(ymin, ymax, Math.max(3, Math.round(plot.h / 90))),
    legendX: plot.x + plot.w + f * 1.2,
    domain: { xmin, xmax, ymin, ymax },
  };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pointOrder(data: FigureData, o: FigureOptions): number[] {
  const count = data.coords.length / 2;
  const normal: number[] = [];
  const selected: number[] = [];
  for (let r = 0; r < count; r++) {
    const row = data.rowIndices ? data.rowIndices[r]! : r;
    if (data.hidden && data.hidden[row]) continue;
    if (o.highlightSelection && data.selection.has(row)) selected.push(r);
    else normal.push(r);
  }
  return [...normal, ...selected];
}

function markerSvg(shape: string, x: number, y: number, s: number, fill: string, extra: string): string {
  const r = s / 2;
  const p = (n: number) => n.toFixed(2);
  switch (shape) {
    case 'square':
      return `<rect x="${p(x - r * 0.88)}" y="${p(y - r * 0.88)}" width="${p(r * 1.76)}" height="${p(r * 1.76)}" fill="${fill}"${extra}/>`;
    case 'triangle':
      return `<polygon points="${p(x)},${p(y - r)} ${p(x + r * 0.95)},${p(y + r * 0.8)} ${p(x - r * 0.95)},${p(y + r * 0.8)}" fill="${fill}"${extra}/>`;
    case 'diamond':
      return `<polygon points="${p(x)},${p(y - r)} ${p(x + r)},${p(y)} ${p(x)},${p(y + r)} ${p(x - r)},${p(y)}" fill="${fill}"${extra}/>`;
    case 'cross':
      return `<path d="M${p(x - r)} ${p(y)}H${p(x + r)}M${p(x)} ${p(y - r)}V${p(y + r)}" stroke="${fill}" stroke-width="${p(r * 0.6)}"${extra}/>`;
    case 'ring':
      return `<circle cx="${p(x)}" cy="${p(y)}" r="${p(r * 0.7)}" fill="none" stroke="${fill}" stroke-width="${p(r * 0.45)}"${extra}/>`;
    default:
      return `<circle cx="${p(x)}" cy="${p(y)}" r="${p(r)}" fill="${fill}"${extra}/>`;
  }
}

function colorOf(data: FigureData, row: number): string {
  const c = data.mapping.colors;
  return rgbToHex([c[row * 3]!, c[row * 3 + 1]!, c[row * 3 + 2]!]);
}

/** Vector SVG figure for 2D projections. Reproducibility metadata is embedded in <metadata>. */
export function renderFigureSvg(
  data: FigureData,
  o: FigureOptions,
  metadata: object,
  sequentialStops: string[],
): string {
  const L = layout(data, o);
  const f = o.fontSize;
  const muted = MUTED(o.foreground);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif">`,
  );
  parts.push(`<metadata><![CDATA[${JSON.stringify(metadata).replace(/]]>/g, ']] >')}]]></metadata>`);
  if (o.background) parts.push(`<rect width="100%" height="100%" fill="${o.background}"/>`);
  if (o.title)
    parts.push(
      `<text x="${L.plot.x}" y="${f * 1.5}" font-size="${f * 1.25}" font-weight="600" fill="${o.foreground}">${esc(o.title)}</text>`,
    );
  if (o.subtitle)
    parts.push(
      `<text x="${L.plot.x}" y="${(o.title ? f * 1.5 : 0) + f * 1.35}" font-size="${f * 0.9}" fill="${muted}">${esc(o.subtitle)}</text>`,
    );
  parts.push(
    `<defs><clipPath id="plot"><rect x="${L.plot.x}" y="${L.plot.y}" width="${L.plot.w}" height="${L.plot.h}"/></clipPath></defs>`,
  );
  if (o.showGrid) {
    parts.push(`<g stroke="${muted}" stroke-opacity="0.18" stroke-width="1">`);
    for (const t of L.xt)
      parts.push(
        `<line x1="${L.sx(t).toFixed(2)}" x2="${L.sx(t).toFixed(2)}" y1="${L.plot.y}" y2="${L.plot.y + L.plot.h}"/>`,
      );
    for (const t of L.yt)
      parts.push(
        `<line y1="${L.sy(t).toFixed(2)}" y2="${L.sy(t).toFixed(2)}" x1="${L.plot.x}" x2="${L.plot.x + L.plot.w}"/>`,
      );
    parts.push('</g>');
  }
  parts.push(`<g clip-path="url(#plot)" fill-opacity="${o.opacity}">`);
  for (const r of pointOrder(data, o)) {
    const row = data.rowIndices ? data.rowIndices[r]! : r;
    const cat = data.mapping.categoryIndex[row]!;
    const shape =
      o.shapes && cat >= 0 ? (MARKER_SHAPES[data.mapping.categories[cat]!.shape] ?? 'circle') : 'circle';
    const highlighted = o.highlightSelection && data.selection.has(row);
    const extra = highlighted
      ? ` stroke="${o.foreground}" stroke-width="${(o.pointSize * 0.18).toFixed(2)}" fill-opacity="1"`
      : '';
    parts.push(
      markerSvg(
        shape,
        L.sx(data.coords[r * 2]!),
        L.sy(data.coords[r * 2 + 1]!),
        o.pointSize * (highlighted ? 1.3 : 1),
        colorOf(data, row),
        extra,
      ),
    );
  }
  parts.push('</g>');
  if (o.showAxes) {
    parts.push(`<g fill="${muted}" font-size="${f * 0.8}">`);
    parts.push(
      `<rect x="${L.plot.x}" y="${L.plot.y}" width="${L.plot.w}" height="${L.plot.h}" fill="none" stroke="${muted}" stroke-opacity="0.6"/>`,
    );
    const stepX = L.xt.length > 1 ? L.xt[1]! - L.xt[0]! : 1;
    const stepY = L.yt.length > 1 ? L.yt[1]! - L.yt[0]! : 1;
    for (const t of L.xt)
      parts.push(
        `<text x="${L.sx(t).toFixed(2)}" y="${L.plot.y + L.plot.h + f * 1.2}" text-anchor="middle">${formatTick(t, stepX)}</text>`,
      );
    for (const t of L.yt)
      parts.push(
        `<text x="${L.plot.x - f * 0.5}" y="${(L.sy(t) + f * 0.28).toFixed(2)}" text-anchor="end">${formatTick(t, stepY)}</text>`,
      );
    parts.push('</g>');
    parts.push(
      `<text x="${L.plot.x + L.plot.w / 2}" y="${L.plot.y + L.plot.h + f * 2.6}" text-anchor="middle" font-size="${f}" fill="${o.foreground}">${esc(o.xLabel)}</text>`,
    );
    parts.push(
      `<text transform="translate(${f * 1.1} ${L.plot.y + L.plot.h / 2}) rotate(-90)" text-anchor="middle" font-size="${f}" fill="${o.foreground}">${esc(o.yLabel)}</text>`,
    );
  }
  parts.push(...legendSvg(data.mapping, L, o, sequentialStops));
  if (o.caption)
    parts.push(
      `<text x="${L.plot.x}" y="${o.height - f * 0.8}" font-size="${f * 0.72}" fill="${muted}">${esc(o.caption)}</text>`,
    );
  parts.push('</svg>');
  return parts.join('\n');
}

function legendSvg(mapping: ColorMapping, L: Layout, o: FigureOptions, sequentialStops: string[]): string[] {
  if (o.legend === 'none' || mapping.mode === 'uniform') return [];
  const f = o.fontSize;
  const out = [
    `<g font-size="${f * 0.85}" fill="${o.foreground}">`,
    `<text x="${L.legendX}" y="${L.plot.y + f * 0.9}" font-weight="600">${esc(mapping.title)}</text>`,
  ];
  if (mapping.mode === 'numeric' && mapping.numericRange) {
    const h = Math.min(L.plot.h - f * 3, f * 10);
    const top = L.plot.y + f * 1.6;
    out.push('<defs><linearGradient id="seq" x1="0" y1="1" x2="0" y2="0">');
    sequentialStops.forEach((c, i) =>
      out.push(
        `<stop offset="${((i / (sequentialStops.length - 1)) * 100).toFixed(1)}%" stop-color="${c}"/>`,
      ),
    );
    out.push('</linearGradient></defs>');
    out.push(`<rect x="${L.legendX}" y="${top}" width="${f * 0.9}" height="${h}" fill="url(#seq)"/>`);
    const step = Math.abs(mapping.numericRange[1] - mapping.numericRange[0]) / 100 || 0.01;
    out.push(
      `<text x="${L.legendX + f * 1.3}" y="${top + f * 0.6}">${formatTick(mapping.numericRange[1], step)}</text>`,
    );
    out.push(
      `<text x="${L.legendX + f * 1.3}" y="${top + h}">${formatTick(mapping.numericRange[0], step)}</text>`,
    );
  } else {
    const maxItems = Math.floor((L.plot.h - f * 2) / (f * 1.4));
    mapping.categories.slice(0, maxItems).forEach((c, i) => {
      const y = L.plot.y + f * 2.2 + i * f * 1.4;
      out.push(
        markerSvg(
          o.shapes ? (MARKER_SHAPES[c.shape] ?? 'circle') : 'circle',
          L.legendX + f * 0.45,
          y - f * 0.3,
          f * 0.75,
          c.color,
          '',
        ),
      );
      out.push(`<text x="${L.legendX + f * 1.2}" y="${y}">${esc(c.label)}</text>`);
    });
    if (mapping.categories.length > maxItems)
      out.push(
        `<text x="${L.legendX}" y="${L.plot.y + f * 2.2 + maxItems * f * 1.4}" fill="${MUTED(o.foreground)}">+${mapping.categories.length - maxItems} more</text>`,
      );
  }
  out.push('</g>');
  return out;
}

/** Raster version of the same figure, drawn with Canvas 2D at `scale` × resolution. */
export function renderFigurePng(
  data: FigureData,
  o: FigureOptions,
  scale: number,
  sequentialStops: string[],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(o.width * scale);
  canvas.height = Math.round(o.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  const L = layout(data, o);
  const f = o.fontSize;
  const muted = MUTED(o.foreground);
  const font = (size: number, weight = 400) =>
    `${weight} ${size}px Inter, 'Helvetica Neue', Arial, sans-serif`;
  if (o.background) {
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, o.width, o.height);
  }
  ctx.textBaseline = 'alphabetic';
  if (o.title) {
    ctx.font = font(f * 1.25, 600);
    ctx.fillStyle = o.foreground;
    ctx.fillText(o.title, L.plot.x, f * 1.5);
  }
  if (o.subtitle) {
    ctx.font = font(f * 0.9);
    ctx.fillStyle = muted;
    ctx.fillText(o.subtitle, L.plot.x, (o.title ? f * 1.5 : 0) + f * 1.35);
  }
  if (o.showGrid) {
    ctx.strokeStyle = muted;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    for (const t of L.xt) {
      ctx.moveTo(L.sx(t), L.plot.y);
      ctx.lineTo(L.sx(t), L.plot.y + L.plot.h);
    }
    for (const t of L.yt) {
      ctx.moveTo(L.plot.x, L.sy(t));
      ctx.lineTo(L.plot.x + L.plot.w, L.sy(t));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.plot.x, L.plot.y, L.plot.w, L.plot.h);
  ctx.clip();
  for (const r of pointOrder(data, o)) {
    const row = data.rowIndices ? data.rowIndices[r]! : r;
    const cat = data.mapping.categoryIndex[row]!;
    const shape =
      o.shapes && cat >= 0 ? (MARKER_SHAPES[data.mapping.categories[cat]!.shape] ?? 'circle') : 'circle';
    const highlighted = o.highlightSelection && data.selection.has(row);
    const size = o.pointSize * (highlighted ? 1.3 : 1);
    ctx.globalAlpha = highlighted ? 1 : o.opacity;
    drawMarker(
      ctx,
      shape,
      L.sx(data.coords[r * 2]!),
      L.sy(data.coords[r * 2 + 1]!),
      size,
      colorOf(data, row),
    );
    if (highlighted) {
      ctx.strokeStyle = o.foreground;
      ctx.lineWidth = o.pointSize * 0.18;
      ctx.beginPath();
      ctx.arc(L.sx(data.coords[r * 2]!), L.sy(data.coords[r * 2 + 1]!), size / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  if (o.showAxes) drawAxes(ctx, L, o, muted, font);
  drawLegend(ctx, data.mapping, L.legendX, L.plot.y, L.plot.h, o, font, sequentialStops);
  if (o.caption) {
    ctx.font = font(f * 0.72);
    ctx.fillStyle = muted;
    ctx.fillText(o.caption, L.plot.x, o.height - f * 0.8);
  }
  return canvas;
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  shape: string,
  x: number,
  y: number,
  s: number,
  color: string,
) {
  const r = s / 2;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.beginPath();
  switch (shape) {
    case 'square':
      ctx.rect(x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76);
      ctx.fill();
      return;
    case 'triangle':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.95, y + r * 0.8);
      ctx.lineTo(x - r * 0.95, y + r * 0.8);
      ctx.fill();
      return;
    case 'diamond':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.fill();
      return;
    case 'cross':
      ctx.lineWidth = r * 0.6;
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y + r);
      ctx.stroke();
      return;
    case 'ring':
      ctx.lineWidth = r * 0.45;
      ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      return;
    default:
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
  }
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  o: FigureOptions,
  muted: string,
  font: (s: number, w?: number) => string,
) {
  const f = o.fontSize;
  ctx.strokeStyle = muted;
  ctx.globalAlpha = 0.6;
  ctx.strokeRect(L.plot.x, L.plot.y, L.plot.w, L.plot.h);
  ctx.globalAlpha = 1;
  ctx.fillStyle = muted;
  ctx.font = font(f * 0.8);
  ctx.textAlign = 'center';
  const stepX = L.xt.length > 1 ? L.xt[1]! - L.xt[0]! : 1;
  const stepY = L.yt.length > 1 ? L.yt[1]! - L.yt[0]! : 1;
  for (const t of L.xt) ctx.fillText(formatTick(t, stepX), L.sx(t), L.plot.y + L.plot.h + f * 1.2);
  ctx.textAlign = 'right';
  for (const t of L.yt) ctx.fillText(formatTick(t, stepY), L.plot.x - f * 0.5, L.sy(t) + f * 0.28);
  ctx.fillStyle = o.foreground;
  ctx.font = font(f);
  ctx.textAlign = 'center';
  ctx.fillText(o.xLabel, L.plot.x + L.plot.w / 2, L.plot.y + L.plot.h + f * 2.6);
  ctx.save();
  ctx.translate(f * 1.1, L.plot.y + L.plot.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(o.yLabel, 0, 0);
  ctx.restore();
  ctx.textAlign = 'left';
}

export function drawLegend(
  ctx: CanvasRenderingContext2D,
  mapping: ColorMapping,
  x: number,
  top: number,
  height: number,
  o: Pick<FigureOptions, 'legend' | 'fontSize' | 'foreground' | 'shapes'>,
  font: (s: number, w?: number) => string,
  sequentialStops: string[],
) {
  if (o.legend === 'none' || mapping.mode === 'uniform') return;
  const f = o.fontSize;
  ctx.textAlign = 'left';
  ctx.fillStyle = o.foreground;
  ctx.font = font(f * 0.85, 600);
  ctx.fillText(mapping.title, x, top + f * 0.9);
  ctx.font = font(f * 0.85);
  if (mapping.mode === 'numeric' && mapping.numericRange) {
    const h = Math.min(height - f * 3, f * 10);
    const grad = ctx.createLinearGradient(0, top + f * 1.6 + h, 0, top + f * 1.6);
    sequentialStops.forEach((c, i) => grad.addColorStop(i / (sequentialStops.length - 1), c));
    ctx.fillStyle = grad;
    ctx.fillRect(x, top + f * 1.6, f * 0.9, h);
    ctx.fillStyle = o.foreground;
    const step = Math.abs(mapping.numericRange[1] - mapping.numericRange[0]) / 100 || 0.01;
    ctx.fillText(formatTick(mapping.numericRange[1], step), x + f * 1.3, top + f * 2.2);
    ctx.fillText(formatTick(mapping.numericRange[0], step), x + f * 1.3, top + f * 1.6 + h);
    return;
  }
  const maxItems = Math.floor((height - f * 2) / (f * 1.4));
  mapping.categories.slice(0, maxItems).forEach((c, i) => {
    const y = top + f * 2.2 + i * f * 1.4;
    drawMarker(
      ctx,
      o.shapes ? (MARKER_SHAPES[c.shape] ?? 'circle') : 'circle',
      x + f * 0.45,
      y - f * 0.3,
      f * 0.75,
      c.color,
    );
    ctx.fillStyle = o.foreground;
    ctx.fillText(c.label, x + f * 1.2, y);
  });
}

/**
 * Composes a 3D WebGL capture with title, legend and caption. 3D scenes are exported as raster
 * images only: a perspective rendering has no faithful vector equivalent.
 */
export function compose3dPng(
  capture: HTMLCanvasElement,
  mapping: ColorMapping,
  o: Pick<
    FigureOptions,
    'background' | 'foreground' | 'title' | 'subtitle' | 'legend' | 'fontSize' | 'shapes' | 'caption'
  >,
  sequentialStops: string[],
): HTMLCanvasElement {
  const pxRatio = Math.max(1, capture.width / 1200);
  const f = o.fontSize * pxRatio;
  const legendW = o.legend === 'right' && mapping.mode !== 'uniform' ? f * 12 : 0;
  const header = (o.title ? f * 2.2 : 0) + (o.subtitle ? f * 1.4 : 0);
  const footer = o.caption ? f * 2 : 0;
  const canvas = document.createElement('canvas');
  canvas.width = capture.width + legendW;
  canvas.height = capture.height + header + footer;
  const ctx = canvas.getContext('2d')!;
  if (o.background) {
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(capture, 0, header);
  const font = (size: number, weight = 400) =>
    `${weight} ${size}px Inter, 'Helvetica Neue', Arial, sans-serif`;
  if (o.title) {
    ctx.font = font(f * 1.25, 600);
    ctx.fillStyle = o.foreground;
    ctx.fillText(o.title, f, f * 1.5);
  }
  if (o.subtitle) {
    ctx.font = font(f * 0.9);
    ctx.fillStyle = MUTED(o.foreground);
    ctx.fillText(o.subtitle, f, (o.title ? f * 1.5 : 0) + f * 1.35);
  }
  drawLegend(
    ctx,
    mapping,
    capture.width + f * 0.5,
    header + f,
    capture.height - f * 2,
    { ...o, fontSize: f },
    font,
    sequentialStops,
  );
  if (o.caption) {
    ctx.font = font(f * 0.72);
    ctx.fillStyle = MUTED(o.foreground);
    ctx.fillText(o.caption, f, canvas.height - f * 0.7);
  }
  return canvas;
}
