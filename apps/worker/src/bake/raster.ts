import { Resvg } from '@resvg/resvg-js';
import sharp, { OverlayOptions } from 'sharp';

/**
 * Renders an SVG string to a 1024x1024 WebP buffer.
 */
export async function renderTileSvgToWebP(svgString: string): Promise<Buffer> {
  const resvg = new Resvg(svgString, {
    fitTo: {
      mode: 'width',
      value: 1024,
    },
    shapeRendering: 2, // geometricPrecision
  });

  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  // Convert PNG to WebP via sharp (SPEC Section 8 & 9)
  return await sharp(pngBuffer)
    .webp({
      quality: 85,
      effort: 4,
    })
    .toBuffer();
}

/**
 * Composites 4 child tiles into a single 1024x1024 parent tile WebP buffer.
 * Each child is resized to 512x512:
 * - child (0, 0) top-left -> (0, 0)
 * - child (1, 0) top-right -> (512, 0)
 * - child (0, 1) bottom-left -> (0, 512)
 * - child (1, 1) bottom-right -> (512, 512)
 */
export async function compositeParentPyramidTile(
  children: {
    tl: Buffer | null;
    tr: Buffer | null;
    bl: Buffer | null;
    br: Buffer | null;
  }
): Promise<Buffer> {
  const composites: OverlayOptions[] = [];

  const addQuadrant = async (buf: Buffer | null, left: number, top: number) => {
    if (!buf) return;
    const resized = await sharp(buf)
      .resize(512, 512, { fit: 'fill' })
      .toBuffer();
    composites.push({
      input: resized,
      left,
      top,
    });
  };

  await Promise.all([
    addQuadrant(children.tl, 0, 0),
    addQuadrant(children.tr, 512, 0),
    addQuadrant(children.bl, 0, 512),
    addQuadrant(children.br, 512, 512),
  ]);

  // Create 1024x1024 transparent canvas and composite quadrants
  return await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ quality: 85, effort: 4 })
    .toBuffer();
}
