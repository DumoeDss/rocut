import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hash, writeJson } from "../particle-c4-export-support.mjs";
import { poll } from "./stylized-fusion-checks.mjs";
import { particleEditorContract } from "./particle-editor-contract.mjs";

export const finalParticleReferenceFrames =
	particleEditorContract.finalReferenceFrames;
export async function finalParticleReferences({
	page,
	root,
	dimensions,
	revision,
	at,
	shot,
}) {
	const interaction = page.getByRole("application", {
		name: "Preview canvas",
		exact: true,
	});
	const overlay = interaction.locator("..");
	// Exact production TransformHandles container, not arbitrary parent buttons.
	const transformRoots = overlay.locator(
		':scope > div[aria-hidden="true"].pointer-events-none',
	);
	const handles = () =>
		transformRoots
			.locator("button")
			.evaluateAll((nodes) =>
				nodes.map((node) => ({
					width: node.getBoundingClientRect().width,
					height: node.getBoundingClientRect().height,
					cursor: getComputedStyle(node).cursor,
				})),
			);
	const selectionState = async () => ({
		transformRoots: await transformRoots.count(),
		handles: await handles(),
		selectedTimelineIds: await page
			.locator('[data-testid="timeline-clip"]')
			.evaluateAll((nodes) =>
				nodes
					.filter((node) => node.parentElement?.parentElement?.style.boxShadow)
					.map((node) => node.getAttribute("data-element-id")),
			),
		focused: await page.evaluate(() => ({
			tag: document.activeElement?.tagName,
			role: document.activeElement?.getAttribute("role"),
		})),
	});
	const beforeSelection = await selectionState();
	// The actual no-hit pointer branch clears selection. No injected state/style.
	await interaction.click({ position: { x: 4, y: 4 } });
	let afterSelection;
	try {
		await poll(async () => {
			afterSelection = await selectionState();
			return (
				afterSelection.transformRoots === 0 &&
				afterSelection.handles.length === 0 &&
				afterSelection.selectedTimelineIds.length === 0
			);
		});
	} finally {
		await writeJson(join(root, "selection-clear.json"), {
			gesture: "Actual Preview canvas pointer click at local 4,4 empty corner",
			before: beforeSelection,
			after: afterSelection,
			scope: "Production TransformHandles DOM + timeline selection ring",
		});
	}
	const canvas = page
		.locator(
			`canvas[width="${dimensions.width}"][height="${dimensions.height}"]`,
		)
		.filter({ visible: true });
	const geometry = async () => ({
		...(await canvas.evaluate((node) => {
			const rect = node.getBoundingClientRect(),
				css = getComputedStyle(node);
			return {
				bounds: {
					x: rect.x,
					y: rect.y,
					width: rect.width,
					height: rect.height,
				},
				devicePixelRatio,
				viewport: { width: innerWidth, height: innerHeight },
				backing: { width: node.width, height: node.height },
				css: {
					transform: css.transform,
					objectFit: css.objectFit,
					opacity: css.opacity,
					borderLeftWidth: css.borderLeftWidth,
					borderTopWidth: css.borderTopWidth,
					borderRightWidth: css.borderRightWidth,
					borderBottomWidth: css.borderBottomWidth,
				},
			};
		})),
		selection: await handles(),
	});
	const frozenGeometry = await geometry();
	assert.deepEqual(frozenGeometry.selection, []);
	const samples = [];
	for (const frame of finalParticleReferenceFrames) {
		await at(frame);
		const visibleShot = await shot(`final-reference-${frame}`, frame);
		const currentGeometry = await geometry();
		assert.deepEqual(
			currentGeometry,
			frozenGeometry,
			"Final references require fixed viewport/CSS/bounds and no selection handles",
		);
		const visibleFile = `${visibleShot.name}.png`,
			visiblePng = await readFile(join(root, visibleFile));
		const visible = {
			file: visibleFile,
			sha256: hash(visiblePng),
			bytes: visiblePng.length,
			width: visiblePng.readUInt32BE(16),
			height: visiblePng.readUInt32BE(20),
		};
		const readback = await canvas.evaluate(async (node, visibleBase64) => {
			try {
				// Read the actual presented UI canvas. Never call renderer APIs, change
				// preserveDrawingBuffer, or alter this canvas/context.
				const blob = await new Promise((done, reject) =>
					node.toBlob(
						(value) =>
							value ? done(value) : reject(Error("Canvas returned no PNG")),
						"image/png",
					),
				);
				const bytes = new Uint8Array(await blob.arrayBuffer());
				let binary = "";
				for (let offset = 0; offset < bytes.length; offset += 32768)
					binary += String.fromCharCode(
						...bytes.subarray(offset, offset + 32768),
					);
				const bitmap = await createImageBitmap(blob);
				const visibleBinary = atob(visibleBase64),
					visibleBytes = Uint8Array.from(visibleBinary, (char) =>
						char.charCodeAt(0),
					);
				const screen = await createImageBitmap(
					new Blob([visibleBytes], { type: "image/png" }),
				);
				// These scratch canvases decode already-captured PNGs only. They do
				// not invoke the project renderer or produce replacement UI evidence.
				const decoded = new OffscreenCanvas(bitmap.width, bitmap.height),
					decodedContext = decoded.getContext("2d", {
						willReadFrequently: true,
					});
				decodedContext.drawImage(bitmap, 0, 0);
				const rgba = decodedContext.getImageData(
					0,
					0,
					bitmap.width,
					bitmap.height,
				).data;
				let nonBlackPixels = 0,
					nonzeroAlphaPixels = 0;
				for (let offset = 0; offset < rgba.length; offset += 4) {
					if (rgba[offset + 3] > 0) nonzeroAlphaPixels++;
					if (
						rgba[offset + 3] > 0 &&
						Math.max(rgba[offset], rgba[offset + 1], rgba[offset + 2]) > 32
					)
						nonBlackPixels++;
				}
				const scaled = new OffscreenCanvas(screen.width, screen.height),
					context = scaled.getContext("2d", { willReadFrequently: true });
				context.drawImage(bitmap, 0, 0, screen.width, screen.height);
				const candidate = context.getImageData(
					0,
					0,
					screen.width,
					screen.height,
				).data;
				context.clearRect(0, 0, screen.width, screen.height);
				context.drawImage(screen, 0, 0);
				const reference = context.getImageData(
					0,
					0,
					screen.width,
					screen.height,
				).data;
				let absoluteError = 0,
					activeError = 0,
					activePixels = 0;
				for (let offset = 0; offset < reference.length; offset += 4) {
					const active =
						Math.max(
							reference[offset],
							reference[offset + 1],
							reference[offset + 2],
						) > 32;
					if (active) activePixels++;
					for (let channel = 0; channel < 3; channel++) {
						const error = Math.abs(
							reference[offset + channel] - candidate[offset + channel],
						);
						absoluteError += error;
						if (active) activeError += error;
					}
				}
				const validation = {
					nonBlackPixels,
					nonzeroAlphaPixels,
					visibleActivePixels: activePixels,
					meanRgbError: absoluteError / (screen.width * screen.height * 3),
					activeMeanRgbError: activePixels
						? activeError / (activePixels * 3)
						: null,
					comparison:
						"Captured backing PNG decoded and downsampled once to visible PNG dimensions; diagnostic only, not a fresh project render or the independent export oracle",
					thresholds: {
						minimumNonBlackPixels: 64,
						meanRgbError: 12,
						activeMeanRgbError: 18,
					},
				};
				bitmap.close();
				screen.close();
				return {
					base64: btoa(binary),
					validation,
					usable:
						nonBlackPixels >= 64 &&
						nonzeroAlphaPixels > 0 &&
						activePixels >= 64 &&
						validation.meanRgbError <= 12 &&
						validation.activeMeanRgbError <= 18,
				};
			} catch (error) {
				return { error: `${error.name}: ${error.message}` };
			}
		}, visiblePng.toString("base64"));
		const backing = {
			status: "unavailable",
			width: dimensions.width,
			height: dimensions.height,
		};
		if (readback.base64) {
			const bytes = Buffer.from(readback.base64, "base64"),
				file = `final-reference-${frame}.backing.png`;
			await writeFile(join(root, file), bytes, { flag: "wx" });
			assert.equal(bytes.readUInt32BE(16), dimensions.width);
			assert.equal(bytes.readUInt32BE(20), dimensions.height);
			Object.assign(backing, {
				status: readback.usable ? "captured" : "unavailable",
				...(readback.usable
					? { file }
					: {
							diagnosticFile: file,
							error:
								"Readback did not pass nonempty/visible-image relationship precheck; visible PNG remains authoritative",
						}),
				sha256: hash(bytes),
				bytes: bytes.length,
				validation: readback.validation,
			});
		} else backing.error = readback.error ?? "Readback unavailable";
		assert.equal(
			hash(await canvas.screenshot()),
			visible.sha256,
			"Readback must not change the actual UI canvas",
		);
		samples.push({
			frame,
			ticks: frame * 4000,
			revision,
			visible,
			backing,
			geometry: currentGeometry,
		});
	}
	return {
		version: 1,
		frames: finalParticleReferenceFrames,
		selectionCleared: true,
		frozenGeometry,
		samples,
		overlay:
			"Production interaction/selection overlay is DOM outside the backing canvas; normal empty-corner pointer click cleared transform roots/handles and timeline selection rings before final captures",
	};
}
