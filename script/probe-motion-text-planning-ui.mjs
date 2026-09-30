#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VITE_ROOT = join(ROOT, "apps", "vite-example");
const plannerCatalog = JSON.parse(
	readFileSync(
		join(
			ROOT,
			"rust",
			"crates",
			"motion-text",
			"resources",
			"jizura-planner-catalog.json",
		),
		"utf8",
	),
);
const presetSetByKey = new Map(
	plannerCatalog.choices.map((choice) => [
		`${choice.group}:${choice.id}`,
		choice.presetSet,
	]),
);

function cutSnapshot(cut) {
	return {
		text: cut.text,
		duration: cut.duration,
		seed: cut.seed,
		preset: cut.preset,
		fontId: cut.fontId ?? null,
		parameters: cut.parameters,
	};
}

function presetKeys(cut) {
	const result = [
		`style:${cut.preset.style}`,
		`layout:${cut.preset.layout}`,
		`enter:${cut.preset.enter}`,
		`hold:${cut.preset.hold}`,
		`exit:${cut.preset.exit}`,
		`treat:${cut.preset.treat}`,
		`bg:${cut.preset.bg}`,
		`cam:${cut.preset.cam}`,
		...cut.preset.decor.map((id) => `decor:${id}`),
		...cut.preset.fx.map((id) => `fx:${id}`),
	];
	if (cut.preset.trans !== null) result.push(`trans:${cut.preset.trans}`);
	return result;
}

const server = await createServer({
	root: VITE_ROOT,
	configFile: join(VITE_ROOT, "vite.config.ts"),
	logLevel: "error",
	resolve: {
		alias: {
			"opencut-wasm": join(ROOT, "rust", "wasm", "pkg", "opencut_wasm.js"),
		},
	},
	server: { host: "127.0.0.1", port: 0, strictPort: false },
});

let browser;
try {
	await server.listen();
	const address = server.httpServer?.address();
	if (
		address === null ||
		typeof address === "string" ||
		address === undefined
	) {
		throw new Error("Vite did not expose a local port");
	}

	browser = await chromium.launch({
		headless: true,
		args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
	});
	const page = await browser.newPage({
		viewport: { width: 1280, height: 900 },
	});
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") pageErrors.push(message.text());
	});

	await page.goto(`http://127.0.0.1:${address.port}/`, {
		waitUntil: "domcontentloaded",
	});
	await page.getByRole("button", { name: "New project" }).click();
	await page
		.getByRole("button", { name: "Motion text" })
		.waitFor({ timeout: 15_000 });
	const projectId = new URL(page.url()).searchParams.get("project");
	assert.ok(projectId, "New project navigation did not expose its id");
	await page.getByRole("button", { name: "Motion text" }).click();
	await page.getByLabel("Lines").fill("LIGHTS RISE\nLIGHTS RISE\nFINAL BEAT");
	await page.getByLabel("Lines").press("Control+Enter");
	await page
		.getByRole("heading", { name: "Sequence defaults" })
		.waitFor({ timeout: 15_000 });
	await page.getByText("r0", { exact: true }).waitFor();

	const readSequence = async () =>
		page.evaluate(async (id) => {
			const { BrowserProjectStore } =
				await import("/@id/@opencut/editor-classic/storage");
			const record = await new BrowserProjectStore().load({ id });
			const sequence = record?.data.motionTextSequences?.[0];
			if (!sequence?.resolvedPlan) {
				throw new Error("The planning probe sequence is missing");
			}
			return sequence;
		}, projectId);
	const planning = page.locator("[data-motion-text-planning-controls]");
	const typography = planning.getByRole("button", {
		name: "Typography",
		exact: true,
	});
	const kinetic = planning.getByRole("button", {
		name: "Kinetic",
		exact: true,
	});
	const horror = planning.getByRole("button", {
		name: "Horror",
		exact: true,
	});
	const unified = planning.getByRole("button", {
		name: "Unified look",
		exact: true,
	});
	const centerFree = planning.getByRole("button", {
		name: "Keep center clear",
		exact: true,
	});
	const topBottom = planning.getByRole("button", {
		name: "Top / bottom",
		exact: true,
	});

	assert.equal(await typography.getAttribute("aria-pressed"), "true");
	assert.equal(await kinetic.getAttribute("aria-pressed"), "true");
	assert.equal(await horror.getAttribute("aria-pressed"), "false");
	assert.equal(await unified.getAttribute("aria-pressed"), "false");
	assert.equal(await centerFree.getAttribute("aria-pressed"), "false");
	assert.equal(await topBottom.isDisabled(), true);
	assert.deepEqual((await readSequence()).planningControls, {
		presetSets: { horror: false, typo: true, kinetic: true },
		unify: false,
		centerFree: false,
		centerDirection: "tb",
	});

	await horror.click();
	await page.getByText("r1", { exact: true }).waitFor();
	assert.equal((await readSequence()).planningControls.presetSets.horror, true);
	await horror.click();
	await page.getByText("r2", { exact: true }).waitFor();
	assert.equal(
		(await readSequence()).planningControls.presetSets.horror,
		false,
	);

	await unified.click();
	await page.getByText("r3", { exact: true }).waitFor();
	const unifiedSequence = await readSequence();
	const repeatedCuts = unifiedSequence.cues
		.slice(0, 2)
		.map((cue) =>
			unifiedSequence.resolvedPlan.cuts
				.filter((cut) => cut.cueId === cue.id)
				.map(cutSnapshot),
		);
	assert.ok(
		repeatedCuts[0].length > 0,
		"Repeated cue produced no resolved cuts",
	);
	assert.deepEqual(repeatedCuts[1], repeatedCuts[0]);

	await centerFree.click();
	await page.getByText("r4", { exact: true }).waitFor();
	const centeredSequence = await readSequence();
	const firstCut = centeredSequence.resolvedPlan.cuts[0];
	const centerParameters = firstCut.parameters["jizura.centerFree"];
	assert.equal(centerParameters.enabled, true);
	assert.equal(centerParameters.direction, "tb");
	assert.ok(centerParameters.firstText.length > 0);
	assert.ok(centerParameters.secondText.length > 0);
	assert.ok(centerParameters.delayTicks >= 0);
	assert.equal(await topBottom.isDisabled(), false);

	const frame = Math.round(
		((firstCut.startTime + firstCut.duration * 0.55) * 30) / 120_000,
	);
	const seconds = Math.floor(frame / 30) % 60;
	const frames = frame % 30;
	await page.locator('button[title="Click to edit time"]').first().click();
	const timecodeInput = page.locator("input.font-mono.tabular-nums").first();
	await timecodeInput.fill(
		`00:00:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`,
	);
	await timecodeInput.press("Enter");
	await page.waitForTimeout(500);
	const preview = page.locator("canvas:visible").first();
	await preview.waitFor();
	const screenshot = await preview.screenshot({ type: "png" });
	const bandPixels = await page.evaluate(
		async (source) => {
			const image = new Image();
			image.src = source;
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext("2d", { willReadFrequently: true });
			if (!context)
				throw new Error("Planning probe could not inspect the preview");
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(
				0,
				0,
				canvas.width,
				canvas.height,
			).data;
			const centerX = Math.floor(canvas.width / 2);
			const centerY = Math.floor(canvas.height / 2);
			const centerIndex = (centerY * canvas.width + centerX) * 4;
			const background = [
				pixels[centerIndex],
				pixels[centerIndex + 1],
				pixels[centerIndex + 2],
			];
			const countInk = (xStart, xEnd) => {
				let count = 0;
				for (
					let y = Math.floor(canvas.height * 0.08);
					y < Math.ceil(canvas.height * 0.92);
					y += 1
				) {
					for (
						let x = Math.floor(canvas.width * xStart);
						x < Math.ceil(canvas.width * xEnd);
						x += 1
					) {
						const index = (y * canvas.width + x) * 4;
						const distance =
							Math.abs(pixels[index] - background[0]) +
							Math.abs(pixels[index + 1] - background[1]) +
							Math.abs(pixels[index + 2] - background[2]);
						if (distance > 72) count += 1;
					}
				}
				return count;
			};
			return {
				width: canvas.width,
				height: canvas.height,
				left: countInk(0.02, 0.38),
				center: countInk(0.42, 0.58),
				right: countInk(0.62, 0.98),
			};
		},
		`data:image/png;base64,${screenshot.toString("base64")}`,
	);
	assert.ok(
		bandPixels.left > 20,
		`Left band was empty: ${JSON.stringify(bandPixels)}`,
	);
	assert.ok(
		bandPixels.right > 20,
		`Right band was empty: ${JSON.stringify(bandPixels)}`,
	);
	assert.ok(
		bandPixels.center <=
			Math.max(8, Math.min(bandPixels.left, bandPixels.right) * 0.03),
		`Center band was not clear: ${JSON.stringify(bandPixels)}`,
	);

	const variation = page
		.getByRole("heading", { name: "Variation" })
		.last()
		.locator("xpath=ancestor::section[1]");
	await variation.getByRole("button", { name: "Generate variation" }).click();
	await variation.getByText("Canvas preview", { exact: true }).waitFor();
	await variation.getByRole("button", { name: "Apply variation" }).click();
	await page.getByText("r5", { exact: true }).waitFor();
	const variedSequence = await readSequence();
	const variedPresetSets = variedSequence.resolvedPlan.cuts.flatMap((cut) =>
		presetKeys(cut)
			.map((key) => presetSetByKey.get(key))
			.filter((presetSet) => presetSet !== null && presetSet !== undefined),
	);
	assert.ok(
		variedPresetSets.length > 0,
		"Variation did not select any family presets",
	);
	assert.equal(variedPresetSets.includes("horror"), false);

	const cueRows = () =>
		page.locator(
			'section[aria-labelledby="motion-text-cues-heading"] > div > button',
		);
	await cueRows().first().click();
	const lockSection = page
		.getByRole("heading", { name: "Locks & inheritance" })
		.locator("xpath=ancestor::section[1]");
	await lockSection.getByRole("button", { name: "Lock cue" }).click();
	await page.getByText("r6", { exact: true }).waitFor();
	const lockedSequence = await readSequence();
	const lockedCueId = lockedSequence.cues[0].id;
	const lockedSnapshot = lockedSequence.resolvedPlan.cuts.filter(
		(cut) => cut.cueId === lockedCueId,
	);
	await kinetic.click();
	await page.getByText("r7", { exact: true }).waitFor();
	const replannedSequence = await readSequence();
	assert.equal(replannedSequence.planningControls.presetSets.kinetic, false);
	assert.deepEqual(
		replannedSequence.resolvedPlan.cuts.filter(
			(cut) => cut.cueId === lockedCueId,
		),
		lockedSnapshot,
	);
	assert.deepEqual(pageErrors, []);

	console.log(
		JSON.stringify(
			{
				checks: {
					defaultControlState: true,
					controlMutationIsSingleRevision: true,
					repeatedLineReusesVisualSnapshot: true,
					centerFreeParameters: true,
					centerFreeSideBands: true,
					disabledFamilyExcludedFromVariation: true,
					fullCueLockPreservesSnapshot: true,
				},
				revision: replannedSequence.revision,
				bandPixels,
			},
			null,
			2,
		),
	);
} finally {
	await browser?.close();
	await server.close();
}
