/** Pixel geometry only; source-time policy remains in the core resolver. */
export function getVisibleFilmstripTiles({
	clipLeft,
	clipWidth,
	viewportLeft,
	viewportRight,
	tileWidth,
}: {
	clipLeft: number;
	clipWidth: number;
	viewportLeft: number;
	viewportRight: number;
	tileWidth: number;
}) {
	if (!(tileWidth > 0) || !(clipWidth > 0)) return [];
	const left = Math.max(0, viewportLeft - clipLeft);
	const right = Math.min(clipWidth, viewportRight - clipLeft);
	if (right <= left) return [];
	const start = Math.floor(left / tileWidth);
	const end = Math.ceil(right / tileWidth);
	return Array.from(
		{ length: Math.min(64, end - start) },
		(_, i) => (start + i) * tileWidth,
	);
}
