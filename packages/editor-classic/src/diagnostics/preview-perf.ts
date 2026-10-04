export interface PreviewFrameSample {
	time: number;
	width: number;
	height: number;
	startedAt: number;
	durationMs: number;
	completed: boolean;
}

export interface PreviewPerfObserver {
	samples: PreviewFrameSample[];
	droppedSamples: number;
}

declare global {
	interface Window {
		__rocutPreviewPerf?: PreviewPerfObserver;
	}
}

// Explicitly opt-in and bounded even when the diagnostic client disconnects.
// Times the preview submission including lock/resolve/upload, not GPU completion
// or display presentation. No thumbnails, snapshots, or exports enter this path.
export function measurePreviewSubmission({
	render,
	time,
	width,
	height,
}: {
	render: () => Promise<void>;
	time: number;
	width: number;
	height: number;
}): Promise<void> {
	const observer =
		typeof window === "undefined" ? undefined : window.__rocutPreviewPerf;
	if (!observer) return render();
	const startedAt = performance.now();
	const finish = (completed: boolean) => {
		if (window.__rocutPreviewPerf !== observer) return;
		const sample = {
			time,
			width,
			height,
			startedAt,
			durationMs: performance.now() - startedAt,
			completed,
		};
		if (observer.samples.length >= 512) {
			observer.droppedSamples += observer.samples.length - 511;
			observer.samples.splice(0, observer.samples.length - 511);
		}
		observer.samples.push(sample);
	};
	return (async () => {
		let completed = false;
		try {
			await render();
			completed = true;
		} finally {
			finish(completed);
		}
	})();
}
