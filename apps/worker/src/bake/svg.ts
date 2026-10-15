import { PALETTE, BRUSH_WIDTHS, DecodedStroke, decodeStroke } from '@infinite-canvas/shared';

/**
 * Converts a tile's visible strokes into an SVG document with viewBox="0 0 65536 65536".
 */
export function generateTileSvg(strokes: { id: number; data: Uint8Array }[]): string {
  const elements: string[] = [];

  for (const item of strokes) {
    let stroke: DecodedStroke;
    try {
      stroke = decodeStroke(item.data);
    } catch {
      continue;
    }

    const color = PALETTE[stroke.colorIndex]?.hex || '#000000';
    const width = BRUSH_WIDTHS[stroke.widthIndex] || 256;
    const pts = stroke.points;

    if (pts.length === 0) continue;

    if (pts.length === 1) {
      // Single point is a filled circle (SPEC Section 8)
      elements.push(
        `<circle cx="${pts[0].x}" cy="${pts[0].y}" r="${width / 2}" fill="${color}" />`
      );
      continue;
    }

    // Polyline / smoothed path with round caps and joins
    if (pts.length === 2) {
      elements.push(
        `<line x1="${pts[0].x}" y1="${pts[0].y}" x2="${pts[1].x}" y2="${pts[1].y}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" />`
      );
      continue;
    }

    // Catmull-Rom converted to cubic Bezier or smooth curve
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? 0 : i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];

      // Catmull-Rom to Cubic Bezier control points
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x} ${p2.y}`;
    }

    elements.push(
      `<path d="${d}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 65536 65536" width="1024" height="1024">
  ${elements.join('\n  ')}
</svg>`;
}
