import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function poll(check, timeout) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const value = await check();
		if (value) return value;
		await new Promise((done) => setTimeout(done, 100));
	}
	throw Error("Flame Wrap editor observation deadline exceeded");
}
function writeArtifact(artifacts, name, bytes) {
	assert(/^[a-z0-9-]+\.rgba$/.test(name));
	return writeFile(join(artifacts.root, name), bytes, { flag: "wx" });
}
export async function capture(
	page,
	artifacts,
	ticks,
	revision,
	label,
	{ timeoutMs = 30000 } = {},
) {
	let previous = null,
		stable = 0,
		latest;
	let emptyFrameSamples = 0,
		totalSamples = 0,
		staleFrameSamples = 0;
	const started = Date.now();
	try {
		await poll(async () => {
			const observed = await page.evaluate(
				({ width, height, useObserver }) => {
					const canvases = [...document.querySelectorAll("canvas")].filter(
						(canvas) =>
							canvas.width === width &&
							canvas.height === height &&
							canvas.getBoundingClientRect().width > 0 &&
							canvas.getBoundingClientRect().height > 0 &&
							getComputedStyle(canvas).visibility !== "hidden" &&
							getComputedStyle(canvas).display !== "none",
					);
					if (canvases.length !== 1)
						throw Error(
							`Expected one visible production ${width}x${height} canvas, got ${canvases.length}`,
						);
					let bytes,
						publication = null;
					if (useObserver) {
						const observer = globalThis.__flameWrapPresentationObserver;
						if (!observer)
							throw Error(
								"Production publication observer missing; idle/screenshot fallback forbidden",
							);
						const minimumSerial =
							globalThis.__flameWrapPresentationMinSerial ?? 0;
						const sample = observer.read(canvases[0]);
						publication = {
							minimumSerial,
							publicationSerial: sample?.serial ?? null,
							contextAttributes: sample?.contextAttributes ?? null,
							observerStatus: observer.status(),
						};
						if (!sample || sample.serial <= minimumSerial)
							return { ...publication, pending: sample ? "stale" : "empty" };
						if (sample.width !== width || sample.height !== height)
							throw Error("Publication geometry mismatch");
						bytes = new Uint8ClampedArray(sample.rgba);
					} else {
						const copy = document.createElement("canvas");
						copy.width = width;
						copy.height = height;
						const context = copy.getContext("2d", { willReadFrequently: true });
						if (!context)
							throw Error("Presentation readback context unavailable");
						context.drawImage(canvases[0], 0, 0);
						bytes = context.getImageData(0, 0, width, height).data;
					}
					let encoded = "",
						visibleAlphaPixels = 0;
					for (let offset = 0; offset < bytes.length; offset += 4096)
						encoded += String.fromCharCode(
							...bytes.subarray(offset, offset + 4096),
						);
					for (let offset = 3; offset < bytes.length; offset += 4)
						visibleAlphaPixels += Number(bytes[offset] > 0);
					return {
						...publication,
						rgbaBase64: btoa(encoded),
						width: canvases[0].width,
						height: canvases[0].height,
						visibleAlphaPixels,
					};
				},
				{
					width: artifacts.width,
					height: artifacts.height,
					useObserver: artifacts.usePresentationObserver === true,
				},
			);
			totalSamples++;
			if (artifacts.usePresentationObserver === true) {
				assert(
					Number.isSafeInteger(observed.minimumSerial) &&
						observed.minimumSerial >= 0,
				);
				if (
					observed.pending ||
					observed.publicationSerial <= observed.minimumSerial
				) {
					if (observed.pending === "empty") emptyFrameSamples++;
					else staleFrameSamples++;
					previous = null;
					stable = 0;
					return false;
				}
				assert(
					Number.isSafeInteger(observed.publicationSerial) &&
						observed.publicationSerial > observed.minimumSerial,
				);
			}
			const bytes = Buffer.from(observed.rgbaBase64, "base64");
			assert.equal(observed.width, artifacts.width);
			assert.equal(observed.height, artifacts.height);
			assert.equal(bytes.length, artifacts.width * artifacts.height * 4);
			assert.equal(bytes.toString("base64"), observed.rgbaBase64);
			assert(
				Number.isSafeInteger(observed.visibleAlphaPixels) &&
					observed.visibleAlphaPixels >= 0 &&
					observed.visibleAlphaPixels <= artifacts.width * artifacts.height,
			);
			if (observed.visibleAlphaPixels === 0) {
				emptyFrameSamples++;
				previous = null;
				stable = 0;
				return false;
			}
			const hash = digest(bytes);
			stable = hash === previous ? stable + 1 : 0;
			previous = hash;
			latest = {
				label,
				ticks,
				width: observed.width,
				height: observed.height,
				rgbaBase64: observed.rgbaBase64,
				clipId: artifacts.clipId,
				sourceClipId: artifacts.clipId,
				revision,
				sha256: hash,
				captureScope:
					artifacts.usePresentationObserver === true
						? "production-presentation-boundary-copy"
						: "production-presentation-canvas",
				...(artifacts.usePresentationObserver === true
					? {
							publicationSerial: observed.publicationSerial,
							minimumSerial: observed.minimumSerial,
							contextAttributes: observed.contextAttributes,
							observerStatus: observed.observerStatus,
						}
					: {}),
				nativeCaptured: false,
				stableConsecutiveSamples: stable + 1,
				emptyFrameSamples,
				totalSamples,
				staleFrameSamples,
				canvasGeometry: { width: observed.width, height: observed.height },
			};
			return stable >= 3 && Date.now() - started >= 1000;
		}, timeoutMs);
	} catch (error) {
		error.captureObservation = {
			label,
			ticks,
			emptyFrameSamples,
			totalSamples,
			staleFrameSamples,
			lastStableConsecutiveSamples: previous === null ? 0 : stable + 1,
			timeoutMs,
		};
		throw error;
	}
	await writeArtifact(
		artifacts,
		`flame-wrap-editor-${label}.rgba`,
		Buffer.from(latest.rgbaBase64, "base64"),
	);
	return latest;
}
