export interface PixelImage { width: number; height: number; pixels: Buffer }
export function pngPixels(png: Buffer): PixelImage;
export function pixelComparison(images: { a: PixelImage; b: PixelImage }): { mean: number; changedPixels: number; totalPixels: number };
export function visibility(image: PixelImage): { background: number[]; changedPixels: number; totalPixels: number };
