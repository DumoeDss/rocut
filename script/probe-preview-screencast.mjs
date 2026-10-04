import assert from "node:assert/strict";
import { createRequire } from "node:module";

// The web workspace already declares sharp. Decode off the renderer thread so
// instrumentation does not serialize every observation through iframe RPC.
const requireWeb = createRequire(
	new URL("../apps/web/package.json", import.meta.url),
);

export async function createScreencastCapture({ page, cdp, displayed }) {
	const sharp = requireWeb("sharp");
	let latest = null;
	let failure = null;
	let closed = false;
	let pending = Promise.resolve();
	let sequence = 0;
	const onFrame = (event) => {
		pending = pending
			.then(async () => {
				try {
					if (closed) return;
					const started = performance.now();
					assert(
						Number.isFinite(event.metadata.timestamp),
						"Missing compositor frame-swap timestamp",
					);
					assert.equal(
						event.metadata.pageScaleFactor,
						1,
						"Unexpected screencast scaling",
					);
					assert.equal(
						event.metadata.offsetTop,
						0,
						"Unexpected screencast top offset",
					);
					const pixels = await sharp(Buffer.from(event.data, "base64"))
						.extract({
							left: Math.round(displayed.x),
							top: Math.round(displayed.y),
							width: Math.floor(displayed.width),
							height: Math.floor(displayed.height),
						})
						.resize(160, 90)
						.ensureAlpha()
						.raw()
						.toBuffer();
					let hash = 2166136261,
						light = 0,
						blue = 0;
					for (const value of pixels)
						hash = Math.imul(hash ^ value, 16777619) >>> 0;
					for (let i = 0; i < pixels.length; i += 4) {
						if (pixels[i] > 160 && pixels[i + 1] > 160 && pixels[i + 2] > 160)
							light++;
						if (pixels[i + 2] > 160 && pixels[i] < 100 && pixels[i + 1] < 100)
							blue++;
					}
					latest = {
						hash: hash.toString(16).padStart(8, "0"),
						light,
						blue,
						frameEpochMs: event.metadata.timestamp * 1000,
						decodeMs: performance.now() - started,
						sequence: ++sequence,
					};
				} catch (error) {
					failure = error;
				} finally {
					if (!closed)
						await cdp.send("Page.screencastFrameAck", {
							sessionId: event.sessionId,
						});
				}
			})
			.catch((error) => {
				failure = error;
			});
	};
	cdp.on("Page.screencastFrame", onFrame);
	try {
		await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
	} catch (error) {
		cdp.off("Page.screencastFrame", onFrame);
		throw error;
	}
	return {
		async capture() {
			// Bounded polling only retrieves already-presented compositor frames.
			// Repeated hashes from a static scene are valid; no synthetic paint.
			await new Promise((resolve) => setTimeout(resolve, 16));
			for (let retry = 0; !latest && !failure && retry < 100; retry++)
				await new Promise((resolve) => setTimeout(resolve, 20));
			if (failure) throw failure;
			assert(latest, "No compositor frames received");
			const observed = latest;
			const state = await page.evaluate(() => {
				const state = window.__rocutVisibleSeekProbe;
				return { ...state, now: performance.now() };
			});
			return {
				...observed,
				trusted: state.trusted,
				decoderTrace: state.decoderTrace,
				milliseconds:
					state.startEpoch === null
						? null
						: observed.frameEpochMs - state.startEpoch,
				observerReturnMs: state.start === null ? null : state.now - state.start,
			};
		},
		async close() {
			closed = true;
			cdp.off("Page.screencastFrame", onFrame);
			await cdp.send("Page.stopScreencast");
			await pending;
		},
	};
}
