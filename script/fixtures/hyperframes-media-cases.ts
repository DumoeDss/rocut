/** Independent pixel expectations, not imported from engine timing functions. */
export const hyperframesMediaCases: Record<string, readonly (readonly [number, number | null])[]> = {
	"media.html": [[1, 1], [2, 2], [17, 17], [18, 18], [23, 23], [36, 36], [37, 37], [16, 16], [0, 0], [59, 59], [60, 0], [61, 1], [119, 59], [120, 0], [121, 1], [23, 23]],
	"media-tail.html": [[59, 59], [60, 59], [150, 59], [1, 1]],
	"media-natural.html": [[59, 59], [60, null], [150, null], [1, 1]],
	"media-trim-loop.html": [[0, 12], [47, 59], [48, 12], [49, 13], [96, 12]],
	// Log-linear speed 1→4 over .2s: source integral .2*(4^(t/.2)-1)/ln(4), then 4x.
	"media-ramp.html": [[5, 5], [10, 14], [15, 26], [20, 43], [21, 47], [24, 59], [25, 3]],
	"media-source.html": [[1, 1], [61, 1]],
	"media-resource.html": [[1, 1], [61, 1]],
};

/** Generated into an isolated project by the preparation script. */
export function hyperframesMediaVariants(html: string): Record<string, string> {
	const rootVideo = 'src="assets/fast.webm"';
	const ramp = JSON.stringify({ version: 1, lanes: [{ target: "rate", points: [{ t: 0, v: 1 }, { t: .2, v: 4 }] }] });
	return {
		"media-tail.html": html.replace('playsinline loop', 'playsinline'),
		"media-natural.html": html.replace('playsinline loop data-start="0" data-duration="2"', 'playsinline data-start="0"'),
		"media-trim-loop.html": html.replace('playsinline loop', 'playsinline loop data-media-start="0.12"'),
		"media-ramp.html": html.replace('playsinline loop', `playsinline loop data-automation='${ramp}'`),
		"media-source.html": html.replace(rootVideo, '').replace('</video>', '<source src="assets/fast.webm" type="video/webm"></video>'),
		"media-resource.html": html.replace(rootVideo, 'data-rocut-src="video/fast.webm"'),
		"media-corrupt.html": html.replace(rootVideo, 'src="data:video/webm;base64,AQID"'),
		"media-audible.html": html.replace('muted playsinline', 'playsinline'),
		"media-autoplay.html": html.replace('muted playsinline', 'muted autoplay playsinline'),
		"media-audio.html": html.replace('</body>', '<audio src="assets/fast.webm"></audio></body>'),
	};
}
