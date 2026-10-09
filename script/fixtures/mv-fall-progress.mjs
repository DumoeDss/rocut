/** Serialized by Playwright: keep this function self-contained and bounded. */
export function fallProgressSnapshot() {
	const progress = globalThis.__fallProgress;
	return {
		current:
			typeof progress?.current === "string"
				? progress.current.slice(0, 160)
				: null,
		observations: Object.keys(progress?.observations ?? {}).length,
		violations: Array.isArray(progress?.violations)
			? progress.violations.length
			: 0,
		completed: !!globalThis.__fallResult,
	};
}

export function startFallProgress(page, write = console.log) {
	const started = Date.now();
	let active = true,
		reading = false;
	const timer = setInterval(async () => {
		if (reading || !active) return;
		reading = true;
		try {
			const progress = await page.evaluate(fallProgressSnapshot);
			if (active)
				write(
					JSON.stringify({
						event: "fall-progress",
						elapsedMs: Date.now() - started,
						...progress,
					}),
				);
		} catch {
			if (active)
				write(
					JSON.stringify({
						event: "fall-progress",
						elapsedMs: Date.now() - started,
						unavailable: true,
					}),
				);
		} finally {
			reading = false;
		}
	}, 30000);
	timer.unref();
	return () => {
		active = false;
		clearInterval(timer);
	};
}
