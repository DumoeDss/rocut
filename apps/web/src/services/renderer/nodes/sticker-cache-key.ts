export function stickerSourceCacheKey({
	url,
	width,
	height,
}: {
	url: string;
	width: number;
	height: number;
}): string {
	return `${url}|${width}x${height}`;
}
