export const DEGRADED_BANNER_TEXT =
	"当前环境的渲染器不可用。仍可编辑，但预览和导出已停用。";
export const PLAYHEAD_LABEL = "时间轴播放头";
export const RULER_LABEL = "时间轴标尺";

function limited(messages) {
	return messages.slice(0, 5).map((message) => String(message).slice(0, 500));
}

export async function waitForDegradedBanner(page, diagnostics) {
	const banner = page.getByText(DEGRADED_BANNER_TEXT, { exact: true });
	try {
		await banner.waitFor({ state: "visible", timeout: 120_000 });
	} catch (error) {
		// Preserve the original failure even if the page closed before inspection.
		const candidates = await Promise.allSettled([
			banner.count(),
			banner.isVisible(),
		]);
		console.error(
			"smoke/degraded-banner diagnostics:",
			JSON.stringify({
				candidates,
				consoleErrors: limited(diagnostics.consoleErrors),
				pageErrors: limited(diagnostics.pageErrors),
				failedResponses: limited(diagnostics.failedResponses),
			}),
		);
		throw error;
	}
}
