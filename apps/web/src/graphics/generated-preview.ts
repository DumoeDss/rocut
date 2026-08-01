const FALLBACK_CORNER_RADIUS_RATIO = 0.2;
const FALLBACK_FILL_OPACITY = 0.08;
const FALLBACK_MIN_FONT_SIZE = 12;
const FALLBACK_FONT_SIZE_RATIO = 0.15;

/** A generated preview is a data URL, never a first-party runtime asset. */
export function buildGeneratedGraphicPreviewUrl({
	name,
	size,
}: {
	name: string;
	size: number;
}): string {
	const svg = `
		<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
			<rect width="${size}" height="${size}" rx="${size * FALLBACK_CORNER_RADIUS_RATIO}" fill="white" fill-opacity="${FALLBACK_FILL_OPACITY}" />
			<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="${Math.max(FALLBACK_MIN_FONT_SIZE, size * FALLBACK_FONT_SIZE_RATIO)}" font-family="sans-serif">${name}</text>
		</svg>
	`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
