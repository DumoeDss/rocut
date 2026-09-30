#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_OUTPUT = join(
	REPO_ROOT,
	"docs",
	"motion-text",
	"jizura-render-probe.json",
);

function argument(name, fallback) {
	const prefix = `--${name}=`;
	const inline = process.argv.find((value) => value.startsWith(prefix));
	if (inline) return inline.slice(prefix.length);
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? fallback : process.argv[index + 1];
}

function percentile(values, quantile) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

const sourceArgument = argument("source", null);
if (!sourceArgument) {
	console.error(
		"Usage: node script/probe-jizura-render.mjs --source <JIZURA checkout> [--output <file>] [--revision <git sha>]",
	);
	process.exit(2);
}

const sourceRoot = resolve(sourceArgument);
const outputPath = resolve(argument("output", DEFAULT_OUTPUT));
const revision = argument("revision", null);
const entry = join(sourceRoot, "index.html");
const sourceVersion = readFileSync(join(sourceRoot, "VERSION"), "utf8").trim();

const browser = await chromium.launch({ headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(String(error)));
	await page.goto(pathToFileURL(entry).href, { waitUntil: "load" });
	await page.waitForFunction(() => Boolean(window.J?.Renderer && window.J?.plan));

	const browserReport = await page.evaluate(async () => {
		const J = window.J;
		for (const face of Object.values(J.FONTS)) {
			face.family = '"Arial"';
			face.weight = face.weight ?? 700;
		}

		let randomState = 0x5eed1234;
		Math.random = () => {
			randomState = (randomState + 0x6d2b79f5) >>> 0;
			let value = randomState;
			value = Math.imul(value ^ (value >>> 15), value | 1);
			value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
			return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
		};

		const project = J.defaultProject();
		Object.assign(project, {
			aspect: "16:9",
			extra: false,
			fps: 30,
			lang: "en",
			lyrics: "WE BUILD IN MOTION\nONE TIMELINE, ONE TRUTH\nSEEK WITHOUT SURPRISES",
			seed: 424242,
			style: "noir",
			timing: {
				bpm: 120,
				lineScale: 1,
				lineTimes: { 0: 0, 1: 2.4, 2: 4.8 },
				offset: 0,
				snap: false,
				tail: 1.2,
			},
			overrides: Object.fromEntries(
				[0, 1, 2].map((index) => [
					index,
					{
						cam: "push",
						decor: ["rings"],
						enter: "pop",
						exit: "shrink",
						hold: "breathe",
						layout: "center",
						single: true,
						treat: "none",
					},
				]),
			),
		});
		project.fx = {
			...project.fx,
			decor: 0.7,
			glitch: 0,
			hud: "off",
			texture: 0,
		};

		const plan = J.plan(project, {
			beats: Array.from({ length: 20 }, (_, index) => index * 0.5),
			duration: 8,
			energy: Array.from({ length: 80 }, () => 0.5),
			energyRate: 10,
		});
		const renderer = new J.Renderer();
		const sampleTimes = [0.35, 1.2, 2.75, 4.15, 5.4, 6.6];

		async function hashPixels(context, width, height) {
			const bytes = context.getImageData(0, 0, width, height).data;
			const digest = await crypto.subtle.digest("SHA-256", bytes);
			return [...new Uint8Array(digest)]
				.map((value) => value.toString(16).padStart(2, "0"))
				.join("");
		}

		async function renderAt({ canvas, context, height, time }) {
			const scale = height / plan.H;
			const width = Math.round(plan.W * scale);
			if (canvas.width !== width) canvas.width = width;
			if (canvas.height !== height) canvas.height = height;
			const startedAt = performance.now();
			renderer.frame(context, plan, time, {
				noHud: true,
				scale,
				transparent: true,
			});
			return {
				durationMs: performance.now() - startedAt,
				hash: await hashPixels(context, width, height),
				height,
				width,
			};
		}

		async function measure(height) {
			const canvas = document.createElement("canvas");
			const context = canvas.getContext("2d", { willReadFrequently: true });
			for (let index = 0; index < 3; index++) {
				await renderAt({ canvas, context, height, time: sampleTimes[index] });
			}
			const durations = [];
			for (let index = 0; index < 30; index++) {
				const time = sampleTimes[index % sampleTimes.length];
				const result = await renderAt({ canvas, context, height, time });
				durations.push(result.durationMs);
			}
			return {
				height,
				width: canvas.width,
				minMs: Math.min(...durations),
				medianMs: durations.slice().sort((a, b) => a - b)[
					Math.floor(durations.length / 2)
				],
				maxMs: Math.max(...durations),
				durations,
			};
		}

		const seekCanvas = document.createElement("canvas");
		const seekContext = seekCanvas.getContext("2d", { willReadFrequently: true });
		const sequential = new Map();
		for (const time of sampleTimes) {
			sequential.set(
				time,
				(await renderAt({ canvas: seekCanvas, context: seekContext, height: 720, time })).hash,
			);
		}

		const randomOrder = [5.4, 0.35, 6.6, 2.75, 1.2, 4.15];
		const randomSeek = [];
		for (const time of randomOrder) {
			const frame = await renderAt({
				canvas: seekCanvas,
				context: seekContext,
				height: 720,
				time,
			});
			randomSeek.push({
				time,
				hash: frame.hash,
				matchesSequential: frame.hash === sequential.get(time),
			});
		}

		await renderAt({
			canvas: seekCanvas,
			context: seekContext,
			height: 720,
			time: 1.2,
		});
		const pixels = seekContext.getImageData(
			0,
			0,
			seekCanvas.width,
			seekCanvas.height,
		).data;
		let transparentPixels = 0;
		let translucentPixels = 0;
		let opaquePixels = 0;
		for (let index = 3; index < pixels.length; index += 4) {
			if (pixels[index] === 0) transparentPixels++;
			else if (pixels[index] === 255) opaquePixels++;
			else translucentPixels++;
		}

		const rocutTexture = new OffscreenCanvas(
			seekCanvas.width,
			seekCanvas.height,
		);
		const rocutTextureContext = rocutTexture.getContext("2d", {
			willReadFrequently: true,
		});
		rocutTextureContext.drawImage(seekCanvas, 0, 0);
		const sourceHash = await hashPixels(
			seekContext,
			seekCanvas.width,
			seekCanvas.height,
		);
		const textureHash = await hashPixels(
			rocutTextureContext,
			rocutTexture.width,
			rocutTexture.height,
		);

		const gpuCanvas = document.createElement("canvas");
		const gl = gpuCanvas.getContext("webgl");
		const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info");

		return {
			plan: {
				cutCount: plan.cuts.length,
				duration: plan.duration,
				height: plan.H,
				width: plan.W,
			},
			alpha: {
				opaquePixels,
				translucentPixels,
				transparentPixels,
			},
			randomSeek,
			rocutTexture: {
				contentHashExample: `motion-text:424242:${Math.round(1.2 * 120000)}`,
				height: rocutTexture.height,
				pixelHash: textureHash,
				pixelHashMatchesSource: textureHash === sourceHash,
				textureKind: "rendered",
				width: rocutTexture.width,
			},
			performance: [await measure(720), await measure(1080)],
			browser: {
				userAgent: navigator.userAgent,
				webglRenderer:
					gl && debugInfo
						? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
						: null,
			},
		};
	});

	for (const measurement of browserReport.performance) {
		measurement.p95Ms = percentile(measurement.durations, 0.95);
		delete measurement.durations;
	}

	const report = {
		schemaVersion: 1,
		generatedBy: "script/probe-jizura-render.mjs",
		source: {
			name: "JIZURA",
			version: sourceVersion,
			revision,
		},
		checks: {
			randomSeekDeterministic: browserReport.randomSeek.every(
				(result) => result.matchesSequential,
			),
			rocutTexturePixelsPreserved:
				browserReport.rocutTexture.pixelHashMatchesSource,
			transparentComposition:
				browserReport.alpha.transparentPixels > 0 &&
				browserReport.alpha.opaquePixels + browserReport.alpha.translucentPixels > 0,
		},
		pageErrors,
		...browserReport,
	};

	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	console.log(`JIZURA render probe -> ${outputPath}`);
	console.log(JSON.stringify(report.checks));
	for (const measurement of report.performance) {
		console.log(
			`${measurement.width}x${measurement.height}: median ${measurement.medianMs.toFixed(2)} ms, p95 ${measurement.p95Ms.toFixed(2)} ms`,
		);
	}
	if (pageErrors.length > 0 || Object.values(report.checks).includes(false)) {
		process.exitCode = 1;
	}
} finally {
	await browser.close();
}
