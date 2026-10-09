import {
	check,
	fingerprint,
	pipelineSize,
	pixels,
} from "./liquid-cancellation-pipeline-support";

function pixelSummary(data: Uint8ClampedArray) {
	const alpha = { min: 255, max: 0, zero: 0, partial: 0, opaque: 0 };
	for (let index = 3; index < data.length; index += 4) {
		const value = data[index];
		alpha.min = Math.min(alpha.min, value);
		alpha.max = Math.max(alpha.max, value);
		if (value === 0) alpha.zero++;
		else if (value === 255) alpha.opaque++;
		else alpha.partial++;
	}
	return { fingerprint: fingerprint(data), pixels: data.length / 4, alpha };
}

function pixelDifference(a: Uint8ClampedArray, b: Uint8ClampedArray) {
	check(a.length === b.length, "Diagnostic pixel lengths differ");
	let changedBytes = 0;
	let changedPixels = 0;
	const maxAbsolute = { rgba: 0, rgb: 0, alpha: 0 };
	const firstChanged: { x: number; y: number; a: number[]; b: number[] }[] = [];
	for (let offset = 0; offset < a.length; offset += 4) {
		let changed = false;
		for (let channel = 0; channel < 4; channel++) {
			const delta = Math.abs(a[offset + channel] - b[offset + channel]);
			if (delta !== 0) {
				changedBytes++;
				changed = true;
			}
			maxAbsolute.rgba = Math.max(maxAbsolute.rgba, delta);
			if (channel === 3) maxAbsolute.alpha = Math.max(maxAbsolute.alpha, delta);
			else maxAbsolute.rgb = Math.max(maxAbsolute.rgb, delta);
		}
		if (!changed) continue;
		changedPixels++;
		if (firstChanged.length < 8)
			firstChanged.push({
				x: (offset / 4) % pipelineSize.width,
				y: Math.floor(offset / 4 / pipelineSize.width),
				a: Array.from(a.subarray(offset, offset + 4)),
				b: Array.from(b.subarray(offset, offset + 4)),
			});
	}
	return { changedBytes, changedPixels, maxAbsolute, firstChanged };
}

/** Read-only instrumentation: controls never mutate the source or target. */
export function targetPixelDiagnostics(
	recovered: Uint8ClampedArray,
	source: CanvasImageSource,
	target: HTMLCanvasElement,
) {
	const freshNative = pixels(source);
	const targetPixels = pixels(target);
	const control = (background?: string) => {
		const canvas = document.createElement("canvas");
		Object.assign(canvas, pipelineSize);
		const context = canvas.getContext("2d");
		check(context, "Missing diagnostic control context");
		if (background) {
			context.fillStyle = background;
			context.fillRect(0, 0, canvas.width, canvas.height);
		}
		context.drawImage(source, 0, 0);
		return pixels(canvas);
	};
	const transparentControl = control();
	const magentaControl = control("#ec2ba4");
	const frames = {
		recovered,
		freshNative,
		targetPixels,
		transparentControl,
		magentaControl,
	};
	const summary = {
		name: "renderToCanvas pixel diagnostics before exact assertion",
		...pipelineSize,
		frames: Object.fromEntries(
			Object.entries(frames).map(([name, data]) => [name, pixelSummary(data)]),
		),
		differences: {
			recoveredVsFreshNative: pixelDifference(recovered, freshNative),
			freshNativeVsTarget: pixelDifference(freshNative, targetPixels),
			recoveredVsTarget: pixelDifference(recovered, targetPixels),
			freshNativeVsTransparentControl: pixelDifference(
				freshNative,
				transparentControl,
			),
			targetVsTransparentControl: pixelDifference(
				targetPixels,
				transparentControl,
			),
			targetVsMagentaControl: pixelDifference(targetPixels, magentaControl),
		},
	};
	Object.assign(globalThis, {
		__liquidPipelineDiagnostics: {
			...summary,
			encoding: "base64 RGBA8, row-major, straight alpha from 2D getImageData",
			rgba: Object.fromEntries(
				Object.entries(frames).map(([name, data]) => [
					name,
					btoa(String.fromCharCode(...data)),
				]),
			),
		},
	});
	return summary;
}
