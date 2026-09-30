#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
	root: ROOT,
	logLevel: "error",
	plugins: [wasm(), topLevelAwait()],
	resolve: {
		alias: {
			"opencut-wasm": join(ROOT, "rust/wasm/pkg/opencut_wasm.js"),
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
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("requestfailed", (request) =>
		pageErrors.push(
			`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "request failed"}`,
		),
	);
	await page.goto(
		`http://127.0.0.1:${address.port}/script/fixtures/motion-text-renderer-browser-probe.html`,
	);
	try {
		await page.waitForFunction(
			() => "__motionTextRendererBrowserProbe" in globalThis,
		);
	} catch (error) {
		throw new Error(
			`Motion-text browser fixture did not complete: ${pageErrors.join("; ") || String(error)}`,
			{ cause: error },
		);
	}
	const result = await page.evaluate(
		() => globalThis.__motionTextRendererBrowserProbe,
	);
	if (pageErrors.length > 0) throw new Error(pageErrors.join("\n"));
	if (result.first.hash !== result.repeated.hash) {
		throw new Error("The same source tick did not reproduce the same pixels");
	}
	if (result.first.hash === result.later.hash) {
		throw new Error("Different source ticks reused stale motion-text pixels");
	}
	if (result.first.hash === result.otherSeed.hash) {
		throw new Error("Different motion-text seeds produced identical pixels");
	}
	if (result.first.hash === result.koreanFrame.hash) {
		throw new Error("Concurrent language fixtures collapsed to one frame");
	}
	if (
		result.first.nonTransparent <= 0 ||
		result.first.opaque >= result.first.total
	) {
		throw new Error("Overlay output did not preserve a transparent background");
	}
	if (result.sceneFrame.opaque !== result.sceneFrame.total) {
		throw new Error("Scene composition did not produce an opaque background");
	}
	const isVisibleOverlay = (frame) =>
		frame.nonTransparent > 0 &&
		frame.opaque < frame.total &&
		frame.bounds !== null;
	const assertDynamicOverlays = ({ entries, expected, label }) => {
		const invalid = entries.filter(([, frames]) =>
			[frames.phaseA, frames.phaseB].some((frame) => !isVisibleOverlay(frame)),
		);
		if (entries.length !== expected || invalid.length > 0) {
			throw new Error(
				`${label} fixtures did not render on a transparent overlay: expected=${expected}, actual=${entries.length}, invalid=${invalid.map(([id]) => id).join(",")}`,
			);
		}
		if (
			entries.some(([, frames]) => frames.phaseA.hash === frames.phaseB.hash)
		) {
			throw new Error(
				`${label} did not change across sampled phases: ${entries
					.filter(([, frames]) => frames.phaseA.hash === frames.phaseB.hash)
					.map(([id]) => id)
					.join(",")}`,
			);
		}
		if (
			new Set(entries.map(([, frames]) => frames.phaseA.hash)).size !== expected
		) {
			throw new Error(`${label} collapsed to identical phase pixels`);
		}
	};
	const baselineStyles = Object.entries(result.baselineStyles);
	if (
		baselineStyles.length !== 5 ||
		baselineStyles.some(([, frame]) => !isVisibleOverlay(frame))
	) {
		throw new Error(
			"Baseline style fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(baselineStyles.map(([, frame]) => frame.hash)).size !== 5) {
		throw new Error("Baseline styles collapsed to identical pixels");
	}
	const horrorStyles = Object.entries(result.horrorStyles);
	if (
		horrorStyles.length !== 3 ||
		horrorStyles.some(([, frame]) => !isVisibleOverlay(frame))
	) {
		throw new Error(
			"Horror style fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(horrorStyles.map(([, frame]) => frame.hash)).size !== 3) {
		throw new Error("Horror styles collapsed to identical pixels");
	}
	const catalogStyles = Object.entries(result.catalogStyles);
	if (
		catalogStyles.length !== 19 ||
		catalogStyles.some(([, frame]) => !isVisibleOverlay(frame))
	) {
		throw new Error(
			"Expanded catalog style fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(catalogStyles.map(([, frame]) => frame.hash)).size !== 19) {
		throw new Error("Expanded catalog styles collapsed to identical pixels");
	}
	const baselineLayouts = Object.entries(result.baselineLayouts);
	if (
		baselineLayouts.length !== 7 ||
		baselineLayouts.some(([, frame]) => !isVisibleOverlay(frame))
	) {
		throw new Error(
			"Baseline layout fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(baselineLayouts.map(([, frame]) => frame.hash)).size !== 7) {
		throw new Error("Baseline layouts collapsed to identical pixels");
	}
	const coreLayouts = Object.entries(result.coreLayouts);
	if (
		coreLayouts.length !== 12 ||
		coreLayouts.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			"Core layout fixtures did not render on a transparent overlay",
		);
	}
	if (
		new Set(coreLayouts.map(([, frames]) => frames.phaseA.hash)).size !== 12
	) {
		throw new Error("Core layouts collapsed to identical phase-A pixels");
	}
	const staticCoreLayouts = new Set(["condensed", "scatter"]);
	if (
		coreLayouts.some(
			([layout, frames]) =>
				!staticCoreLayouts.has(layout) &&
				frames.phaseA.hash === frames.phaseB.hash,
		)
	) {
		throw new Error(
			`Dynamic core layouts did not change across sampled phases: ${coreLayouts
				.filter(
					([layout, frames]) =>
						!staticCoreLayouts.has(layout) &&
						frames.phaseA.hash === frames.phaseB.hash,
				)
				.map(([layout]) => layout)
				.join(",")}`,
		);
	}
	const layoutsA = Object.entries(result.layoutsA);
	if (
		layoutsA.length !== 28 ||
		layoutsA.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			"LayoutsA fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(layoutsA.map(([, frames]) => frames.phaseA.hash)).size !== 28) {
		throw new Error("LayoutsA collapsed to identical phase-A pixels");
	}
	if (
		layoutsA.some(([, frames]) => frames.phaseA.hash === frames.phaseB.hash)
	) {
		throw new Error(
			`LayoutsA did not change across sampled phases: ${layoutsA
				.filter(([, frames]) => frames.phaseA.hash === frames.phaseB.hash)
				.map(([layout]) => layout)
				.join(",")}`,
		);
	}
	const layoutsB = Object.entries(result.layoutsB);
	if (
		layoutsB.length !== 27 ||
		layoutsB.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			"LayoutsB fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(layoutsB.map(([, frames]) => frames.phaseA.hash)).size !== 27) {
		throw new Error("LayoutsB collapsed to identical phase-A pixels");
	}
	if (
		layoutsB.some(([, frames]) => frames.phaseA.hash === frames.phaseB.hash)
	) {
		throw new Error(
			`LayoutsB did not change across sampled phases: ${layoutsB
				.filter(([, frames]) => frames.phaseA.hash === frames.phaseB.hash)
				.map(([layout]) => layout)
				.join(",")}`,
		);
	}
	const layoutsC = Object.entries(result.layoutsC);
	if (
		layoutsC.length !== 34 ||
		layoutsC.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			"LayoutsC fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(layoutsC.map(([, frames]) => frames.phaseA.hash)).size !== 34) {
		throw new Error("LayoutsC collapsed to identical phase-A pixels");
	}
	if (
		layoutsC.some(([, frames]) => frames.phaseA.hash === frames.phaseB.hash)
	) {
		throw new Error(
			`LayoutsC did not change across sampled phases: ${layoutsC
				.filter(([, frames]) => frames.phaseA.hash === frames.phaseB.hash)
				.map(([layout]) => layout)
				.join(",")}`,
		);
	}
	const layoutsD = Object.entries(result.layoutsD);
	if (
		layoutsD.length !== 34 ||
		layoutsD.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			"LayoutsD fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(layoutsD.map(([, frames]) => frames.phaseA.hash)).size !== 34) {
		throw new Error("LayoutsD collapsed to identical phase-A pixels");
	}
	if (
		layoutsD.some(([, frames]) => frames.phaseA.hash === frames.phaseB.hash)
	) {
		throw new Error(
			`LayoutsD did not change across sampled phases: ${layoutsD
				.filter(([, frames]) => frames.phaseA.hash === frames.phaseB.hash)
				.map(([layout]) => layout)
				.join(",")}`,
		);
	}
	const baselineEntrances = Object.entries(result.baselineEntrances);
	if (
		baselineEntrances.length !== 6 ||
		baselineEntrances.some(([, frames]) =>
			[frames.early, frames.settled].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			"Baseline entrance fixtures did not render on a transparent overlay",
		);
	}
	if (
		baselineEntrances.some(
			([enter, frames]) =>
				enter !== "cut" && frames.early.hash === frames.settled.hash,
		)
	) {
		throw new Error(
			"Dynamic baseline entrances did not change before settling",
		);
	}
	const baselineHolds = Object.entries(result.baselineHolds);
	if (
		baselineHolds.length !== 7 ||
		baselineHolds.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			"Baseline hold fixtures did not render on a transparent overlay",
		);
	}
	if (
		baselineHolds.some(
			([hold, frames]) =>
				hold !== "still" && frames.phaseA.hash === frames.phaseB.hash,
		)
	) {
		throw new Error(
			"Dynamic baseline holds did not change across sampled phases",
		);
	}
	const baselineExits = Object.entries(result.baselineExits);
	if (
		baselineExits.length !== 7 ||
		baselineExits.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			"Baseline exit fixtures did not render on a transparent overlay",
		);
	}
	if (
		baselineExits.some(
			([exit, frames]) =>
				exit !== "cut" && frames.phaseA.hash === frames.phaseB.hash,
		)
	) {
		throw new Error(
			"Dynamic baseline exits did not change across sampled phases",
		);
	}
	const coreAnimEntrances = Object.entries(result.coreAnimEntrances);
	assertDynamicOverlays({
		entries: coreAnimEntrances,
		expected: 9,
		label: "Core animation entrances",
	});
	const coreAnimHolds = Object.entries(result.coreAnimHolds);
	assertDynamicOverlays({
		entries: coreAnimHolds,
		expected: 2,
		label: "Core animation holds",
	});
	const coreAnimExits = Object.entries(result.coreAnimExits);
	assertDynamicOverlays({
		entries: coreAnimExits,
		expected: 6,
		label: "Core animation exits",
	});
	const baselineTreatments = Object.entries(result.baselineTreatments);
	if (
		baselineTreatments.length !== 5 ||
		baselineTreatments.some(([, frame]) => !isVisibleOverlay(frame))
	) {
		throw new Error(
			"Baseline treatment fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(baselineTreatments.map(([, frame]) => frame.hash)).size !== 5) {
		throw new Error("Baseline treatments collapsed to identical pixels");
	}
	const baselineBackgrounds = Object.entries(result.baselineBackgrounds);
	if (
		baselineBackgrounds.length !== 1 ||
		baselineBackgrounds.some(([, frame]) => !isVisibleOverlay(frame))
	) {
		throw new Error(
			"Baseline background fixture did not render on a transparent overlay",
		);
	}
	const baselineCameras = Object.entries(result.baselineCameras);
	if (
		baselineCameras.length !== 1 ||
		baselineCameras.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			"Baseline camera fixture did not render on a transparent overlay",
		);
	}
	if (
		baselineCameras.some(
			([, frames]) => frames.phaseA.hash === frames.phaseB.hash,
		)
	) {
		throw new Error(
			"Baseline push camera did not change across sampled phases",
		);
	}
	const variantScenarios = result.variantMatrix.scenarios;
	const expectedVariantGroups = [
		"style",
		"layout",
		"enter",
		"hold",
		"exit",
		"decor",
		"treat",
		"bg",
		"cam",
		"fx",
		"trans",
	];
	if (
		variantScenarios.length !== 8 ||
		new Set(variantScenarios.map((scenario) => scenario.id)).size !== 8 ||
		new Set(variantScenarios.map((scenario) => scenario.language)).size !== 4 ||
		new Set(variantScenarios.map((scenario) => scenario.compositionMode))
			.size !== 2 ||
		!variantScenarios.some((scenario) => scenario.id.includes("-short-")) ||
		!variantScenarios.some((scenario) => scenario.id.includes("-long-")) ||
		!variantScenarios.some((scenario) => scenario.width > scenario.height) ||
		!variantScenarios.some((scenario) => scenario.height > scenario.width)
	) {
		throw new Error(
			"Variant matrix did not cover text length, language, aspect, and composition axes",
		);
	}
	const variantFamilies = Object.entries(result.variantMatrix.families);
	if (
		variantFamilies.length !== expectedVariantGroups.length ||
		expectedVariantGroups.some(
			(group) => !(group in result.variantMatrix.families),
		)
	) {
		throw new Error(
			"Variant matrix did not cover every supported preset group",
		);
	}
	for (const [group, framesByScenario] of variantFamilies) {
		const frames = Object.entries(framesByScenario);
		if (
			frames.length !== variantScenarios.length ||
			variantScenarios.some((scenario) => !(scenario.id in framesByScenario))
		) {
			throw new Error(`Variant matrix ${group} family is incomplete`);
		}
		for (const [scenarioId, frame] of frames) {
			const scenario = variantScenarios.find(
				(candidate) => candidate.id === scenarioId,
			);
			if (!scenario) {
				throw new Error(`Variant matrix ${group} has unknown ${scenarioId}`);
			}
			if (
				frame.nonTransparent <= 0 ||
				frame.bounds === null ||
				frame.total !== scenario.width * scenario.height ||
				(scenario.compositionMode === "overlay"
					? frame.opaque >= frame.total
					: frame.opaque !== frame.total)
			) {
				throw new Error(
					`Variant matrix ${group}.${scenarioId} violated ${scenario.compositionMode} pixel semantics`,
				);
			}
		}
		if (new Set(frames.map(([, frame]) => frame.hash)).size !== frames.length) {
			throw new Error(
				`Variant matrix ${group} collapsed distinct scenarios to identical pixels`,
			);
		}
	}
	const typographyFrames = Object.entries(result.typographyLayouts);
	if (
		typographyFrames.length !== 18 ||
		typographyFrames.some(
			([, frame]) =>
				frame.nonTransparent <= 0 ||
				frame.opaque >= frame.total ||
				frame.bounds === null,
		)
	) {
		throw new Error(
			"Typography layout fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(typographyFrames.map(([, frame]) => frame.hash)).size !== 18) {
		throw new Error("Typography layouts collapsed to identical pixels");
	}
	const kineticLayouts = Object.entries(result.kineticLayouts);
	if (
		kineticLayouts.length !== 14 ||
		kineticLayouts.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some(
				(frame) =>
					frame.nonTransparent <= 0 ||
					frame.opaque >= frame.total ||
					frame.bounds === null,
			),
		)
	) {
		throw new Error(
			"Kinetic layout fixtures did not render on a transparent overlay",
		);
	}
	if (
		kineticLayouts.some(
			([, frames]) => frames.phaseA.hash === frames.phaseB.hash,
		)
	) {
		throw new Error("Kinetic layouts did not change across sampled phases");
	}
	if (
		new Set(kineticLayouts.map(([, frames]) => frames.phaseA.hash)).size !== 14
	) {
		throw new Error("Kinetic layouts collapsed to identical phase pixels");
	}
	const horrorLayouts = Object.entries(result.horrorLayouts);
	if (
		horrorLayouts.length !== 12 ||
		horrorLayouts.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			"Horror layout fixtures did not render on a transparent overlay",
		);
	}
	if (
		horrorLayouts.some(
			([, frames]) => frames.phaseA.hash === frames.phaseB.hash,
		)
	) {
		throw new Error("Horror layouts did not change across sampled phases");
	}
	if (
		new Set(horrorLayouts.map(([, frames]) => frames.phaseA.hash)).size !== 12
	) {
		throw new Error("Horror layouts collapsed to identical phase pixels");
	}
	const horrorEntrances = Object.entries(result.horrorEntrances);
	if (
		horrorEntrances.length !== 7 ||
		horrorEntrances.some(([, frames]) =>
			[frames.early, frames.settled].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			"Horror entrance fixtures did not render on a transparent overlay",
		);
	}
	if (
		horrorEntrances.some(
			([, frames]) => frames.early.hash === frames.settled.hash,
		)
	) {
		throw new Error("Horror entrances did not change before settling");
	}
	if (
		new Set(horrorEntrances.map(([, frames]) => frames.early.hash)).size !== 7
	) {
		throw new Error("Horror entrances collapsed to identical early pixels");
	}
	const horrorHolds = Object.entries(result.horrorHolds);
	if (
		horrorHolds.length !== 4 ||
		horrorHolds.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			"Horror hold fixtures did not render on a transparent overlay",
		);
	}
	if (
		horrorHolds.some(([, frames]) => frames.phaseA.hash === frames.phaseB.hash)
	) {
		throw new Error("Horror holds did not change across sampled phases");
	}
	if (new Set(horrorHolds.map(([, frames]) => frames.phaseA.hash)).size !== 4) {
		throw new Error("Horror holds collapsed to identical phase pixels");
	}
	const horrorExits = Object.entries(result.horrorExits);
	if (
		horrorExits.length !== 7 ||
		horrorExits.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			`Horror exit fixtures did not render on a transparent overlay: ${horrorExits
				.map(
					([exit, frames]) =>
						`${exit}=${frames.phaseA.nonTransparent}/${frames.phaseB.nonTransparent}`,
				)
				.join(",")}`,
		);
	}
	if (
		horrorExits.some(([, frames]) => frames.phaseA.hash === frames.phaseB.hash)
	) {
		throw new Error("Horror exits did not change across sampled phases");
	}
	if (new Set(horrorExits.map(([, frames]) => frames.phaseA.hash)).size !== 7) {
		throw new Error("Horror exits collapsed to identical phase pixels");
	}
	const horrorTreatments = Object.entries(result.horrorTreatments);
	if (
		horrorTreatments.length !== 4 ||
		horrorTreatments.some(([, frame]) => !isVisibleOverlay(frame))
	) {
		throw new Error(
			"Horror treatment fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(horrorTreatments.map(([, frame]) => frame.hash)).size !== 4) {
		throw new Error("Horror treatments collapsed to identical pixels");
	}
	const horrorDecors = Object.entries(result.horrorDecors);
	assertDynamicOverlays({
		entries: horrorDecors,
		expected: 7,
		label: "Horror decors",
	});
	const horrorBackgrounds = Object.entries(result.horrorBackgrounds);
	assertDynamicOverlays({
		entries: horrorBackgrounds,
		expected: 4,
		label: "Horror backgrounds",
	});
	const horrorCameras = Object.entries(result.horrorCameras);
	assertDynamicOverlays({
		entries: horrorCameras,
		expected: 2,
		label: "Horror cameras",
	});
	const bgcamBackgrounds = Object.entries(result.bgcamBackgrounds);
	assertDynamicOverlays({
		entries: bgcamBackgrounds,
		expected: 37,
		label: "Bgcam backgrounds",
	});
	const bgcamCameras = Object.entries(result.bgcamCameras);
	assertDynamicOverlays({
		entries: bgcamCameras,
		expected: 12,
		label: "Bgcam cameras",
	});
	const exitHoldHolds = Object.entries(result.exitHoldHolds);
	assertDynamicOverlays({
		entries: exitHoldHolds,
		expected: 17,
		label: "ExitHold holds",
	});
	const exitHoldExits = Object.entries(result.exitHoldExits);
	assertDynamicOverlays({
		entries: exitHoldExits,
		expected: 34,
		label: "ExitHold exits",
	});
	const exitBHolds = Object.entries(result.exitBHolds);
	assertDynamicOverlays({
		entries: exitBHolds,
		expected: 12,
		label: "Exit B holds",
	});
	const exitBExits = Object.entries(result.exitBExits);
	assertDynamicOverlays({
		entries: exitBExits,
		expected: 39,
		label: "Exit B exits",
	});
	const coreDecors = Object.entries(result.coreDecors);
	assertDynamicOverlays({
		entries: coreDecors,
		expected: 15,
		label: "Core decors",
	});
	const extendedDecors = Object.entries(result.extendedDecors);
	assertDynamicOverlays({
		entries: extendedDecors,
		expected: 45,
		label: "Extended decors",
	});
	const decorB = Object.entries(result.decorB);
	assertDynamicOverlays({
		entries: decorB,
		expected: 55,
		label: "Decor B",
	});
	const looksTreatments = Object.entries(result.looksTreatments);
	if (
		looksTreatments.length !== 20 ||
		looksTreatments.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			"Looks treatment fixtures did not render on a transparent overlay",
		);
	}
	if (
		new Set(looksTreatments.map(([, frames]) => frames.phaseA.hash)).size !== 20
	) {
		throw new Error("Looks treatments collapsed to identical phase-A pixels");
	}
	const dynamicLooksTreatments = new Set([
		"extrude",
		"longShadow",
		"marker",
		"strike",
		"boxed",
		"halftone",
		"dotted",
		"echoOutline",
		"emphasisDots",
	]);
	if (
		looksTreatments.some(
			([treat, frames]) =>
				dynamicLooksTreatments.has(treat) &&
				frames.phaseA.hash === frames.phaseB.hash,
		)
	) {
		throw new Error(
			`Dynamic Looks treatments did not change across sampled phases: ${looksTreatments
				.filter(
					([treat, frames]) =>
						dynamicLooksTreatments.has(treat) &&
						frames.phaseA.hash === frames.phaseB.hash,
				)
				.map(([treat]) => treat)
				.join(",")}`,
		);
	}
	const looksBackgrounds = Object.entries(result.looksBackgrounds);
	assertDynamicOverlays({
		entries: looksBackgrounds,
		expected: 24,
		label: "Looks backgrounds",
	});
	const looksCameras = Object.entries(result.looksCameras);
	assertDynamicOverlays({
		entries: looksCameras,
		expected: 15,
		label: "Looks cameras",
	});
	const looksEffects = Object.entries(result.looksEffects);
	assertDynamicOverlays({
		entries: looksEffects,
		expected: 24,
		label: "Looks screen effects",
	});
	const horrorEffects = Object.entries(result.horrorEffects);
	assertDynamicOverlays({
		entries: horrorEffects,
		expected: 3,
		label: "Horror screen effects",
	});
	const coreEffects = Object.entries(result.coreEffects);
	assertDynamicOverlays({
		entries: coreEffects,
		expected: 8,
		label: "Core screen effects",
	});
	const fxBEffects = Object.entries(result.fxBEffects);
	assertDynamicOverlays({
		entries: fxBEffects,
		expected: 34,
		label: "FxB screen effects",
	});
	if (
		coreEffects.some(
			([, frames]) =>
				!isVisibleOverlay(frames.offscreen) ||
				frames.offscreen.hash !== frames.phaseA.hash,
		)
	) {
		throw new Error(
			"Core screen effects diverged between HTMLCanvas and OffscreenCanvas",
		);
	}
	const horrorTransitions = Object.entries(result.horrorTransitions);
	assertDynamicOverlays({
		entries: horrorTransitions,
		expected: 2,
		label: "Horror transitions",
	});
	const typographyEntrances = Object.entries(result.typographyEntrances);
	if (
		typographyEntrances.length !== 8 ||
		typographyEntrances.some(([, frames]) =>
			[frames.early, frames.settled].some(
				(frame) =>
					frame.nonTransparent <= 0 ||
					frame.opaque >= frame.total ||
					frame.bounds === null,
			),
		)
	) {
		throw new Error(
			"Typography entrance fixtures did not render on a transparent overlay",
		);
	}
	if (
		typographyEntrances.some(
			([, frames]) => frames.early.hash === frames.settled.hash,
		)
	) {
		throw new Error(
			"Typography entrances did not change after their early phase",
		);
	}
	if (
		new Set(typographyEntrances.map(([, frames]) => frames.early.hash)).size !==
		8
	) {
		throw new Error("Typography entrances collapsed to identical early pixels");
	}
	const enterBEntrances = Object.entries(result.enterBEntrances);
	assertDynamicOverlays({
		entries: enterBEntrances,
		expected: 47,
		label: "EnterB entrances",
	});
	const enterAEntrances = Object.entries(result.enterAEntrances);
	assertDynamicOverlays({
		entries: enterAEntrances,
		expected: 38,
		label: "Enter source-family entrances",
	});
	const typographyHolds = Object.entries(result.typographyHolds);
	if (
		typographyHolds.length !== 4 ||
		typographyHolds.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some(
				(frame) =>
					frame.nonTransparent <= 0 ||
					frame.opaque >= frame.total ||
					frame.bounds === null,
			),
		)
	) {
		throw new Error(
			"Typography hold fixtures did not render on a transparent overlay",
		);
	}
	if (
		typographyHolds.some(
			([, frames]) => frames.phaseA.hash === frames.phaseB.hash,
		)
	) {
		throw new Error("Typography holds did not change across sampled phases");
	}
	if (
		new Set(typographyHolds.map(([, frames]) => frames.phaseA.hash)).size !== 4
	) {
		throw new Error("Typography holds collapsed to identical phase pixels");
	}
	const typographyExits = Object.entries(result.typographyExits);
	if (
		typographyExits.length !== 8 ||
		typographyExits.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some(
				(frame) =>
					frame.nonTransparent <= 0 ||
					frame.opaque >= frame.total ||
					frame.bounds === null,
			),
		)
	) {
		throw new Error(
			`Typography exit fixtures did not render on a transparent overlay: ${typographyExits
				.map(
					([exit, frames]) =>
						`${exit}=${frames.phaseA.nonTransparent}/${frames.phaseB.nonTransparent}`,
				)
				.join(",")}`,
		);
	}
	if (
		typographyExits.some(
			([, frames]) => frames.phaseA.hash === frames.phaseB.hash,
		)
	) {
		throw new Error("Typography exits did not change across sampled phases");
	}
	if (
		new Set(typographyExits.map(([, frames]) => frames.phaseA.hash)).size !== 8
	) {
		throw new Error("Typography exits collapsed to identical phase pixels");
	}
	const typographyDecors = Object.entries(result.typographyDecors);
	if (
		typographyDecors.length !== 6 ||
		typographyDecors.some(
			([, frame]) =>
				frame.nonTransparent <= 0 ||
				frame.opaque >= frame.total ||
				frame.bounds === null,
		)
	) {
		throw new Error(
			"Typography decor fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(typographyDecors.map(([, frame]) => frame.hash)).size !== 6) {
		throw new Error("Typography decors collapsed to identical pixels");
	}
	const typographyTreatments = Object.entries(result.typographyTreatments);
	if (
		typographyTreatments.length !== 4 ||
		typographyTreatments.some(
			([, frame]) =>
				frame.nonTransparent <= 0 ||
				frame.opaque >= frame.total ||
				frame.bounds === null,
		)
	) {
		throw new Error(
			"Typography treatment fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(typographyTreatments.map(([, frame]) => frame.hash)).size !== 4) {
		throw new Error("Typography treatments collapsed to identical pixels");
	}
	const typographyTransitions = Object.entries(result.typographyTransitions);
	if (
		typographyTransitions.length !== 2 ||
		typographyTransitions.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some(
				(frame) =>
					frame.nonTransparent <= 0 ||
					frame.opaque >= frame.total ||
					frame.bounds === null,
			),
		)
	) {
		throw new Error(
			"Typography transition fixtures did not render on a transparent overlay",
		);
	}
	if (
		typographyTransitions.some(
			([, frames]) => frames.phaseA.hash === frames.phaseB.hash,
		)
	) {
		throw new Error(
			"Typography transitions did not change across sampled phases",
		);
	}
	if (
		new Set(typographyTransitions.map(([, frames]) => frames.phaseA.hash))
			.size !== 2
	) {
		throw new Error(
			"Typography transitions collapsed to identical phase pixels",
		);
	}
	const treatTransTreatments = Object.entries(result.treatTransTreatments);
	if (
		treatTransTreatments.length !== 27 ||
		treatTransTreatments.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some((frame) => !isVisibleOverlay(frame)),
		)
	) {
		throw new Error(
			"Treat/transition treatment fixtures did not render on a transparent overlay",
		);
	}
	if (
		new Set(treatTransTreatments.map(([, frames]) => frames.phaseA.hash))
			.size !== 27
	) {
		throw new Error(
			"Treat/transition treatments collapsed to identical phase-A pixels",
		);
	}
	const dynamicTreatments = new Set([
		"neonOutline",
		"rainbow",
		"glitchSplit",
		"stencilGap",
		"waterline",
		"karaoke",
		"sizeWave",
		"gradientSweep",
		"cutShift",
		"focusPull",
	]);
	const staticDynamicTreatments = treatTransTreatments.filter(
		([treat, frames]) =>
			dynamicTreatments.has(treat) && frames.phaseA.hash === frames.phaseB.hash,
	);
	if (staticDynamicTreatments.length > 0) {
		throw new Error(
			`Treat/transition dynamic treatments did not change: ${staticDynamicTreatments.map(([treat]) => treat).join(",")}`,
		);
	}
	const treatTransTransitions = Object.entries(result.treatTransTransitions);
	assertDynamicOverlays({
		entries: treatTransTransitions,
		expected: 20,
		label: "Treat/transition transitions",
	});
	const kineticDecors = Object.entries(result.kineticDecors);
	if (
		kineticDecors.length !== 2 ||
		kineticDecors.some(
			([, frame]) =>
				frame.nonTransparent <= 0 ||
				frame.opaque >= frame.total ||
				frame.bounds === null,
		)
	) {
		throw new Error(
			"Kinetic decor fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(kineticDecors.map(([, frame]) => frame.hash)).size !== 2) {
		throw new Error("Kinetic decors collapsed to identical pixels");
	}
	const kineticTreatments = Object.entries(result.kineticTreatments);
	if (
		kineticTreatments.length !== 2 ||
		kineticTreatments.some(
			([, frame]) =>
				frame.nonTransparent <= 0 ||
				frame.opaque >= frame.total ||
				frame.bounds === null,
		)
	) {
		throw new Error(
			"Kinetic treatment fixtures did not render on a transparent overlay",
		);
	}
	if (new Set(kineticTreatments.map(([, frame]) => frame.hash)).size !== 2) {
		throw new Error("Kinetic treatments collapsed to identical pixels");
	}
	const kineticTransitions = Object.entries(result.kineticTransitions);
	if (
		kineticTransitions.length !== 3 ||
		kineticTransitions.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some(
				(frame) =>
					frame.nonTransparent <= 0 ||
					frame.opaque >= frame.total ||
					frame.bounds === null,
			),
		)
	) {
		throw new Error(
			"Kinetic transition fixtures did not render on a transparent overlay",
		);
	}
	if (
		kineticTransitions.some(
			([, frames]) => frames.phaseA.hash === frames.phaseB.hash,
		)
	) {
		throw new Error("Kinetic transitions did not change across sampled phases");
	}
	if (
		new Set(kineticTransitions.map(([, frames]) => frames.phaseA.hash)).size !==
		3
	) {
		throw new Error("Kinetic transitions collapsed to identical phase pixels");
	}
	const kineticCameras = Object.entries(result.kineticCameras);
	if (
		kineticCameras.length !== 6 ||
		kineticCameras.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some(
				(frame) =>
					frame.nonTransparent <= 0 ||
					frame.opaque >= frame.total ||
					frame.bounds === null,
			),
		)
	) {
		throw new Error(
			"Kinetic camera fixtures did not render on a transparent overlay",
		);
	}
	if (
		kineticCameras.some(
			([, frames]) => frames.phaseA.hash === frames.phaseB.hash,
		)
	) {
		throw new Error("Kinetic cameras did not change across sampled phases");
	}
	if (
		new Set(kineticCameras.map(([, frames]) => frames.phaseA.hash)).size !== 6
	) {
		throw new Error("Kinetic cameras collapsed to identical phase pixels");
	}
	const kineticHolds = Object.entries(result.kineticHolds);
	if (
		kineticHolds.length !== 6 ||
		kineticHolds.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some(
				(frame) =>
					frame.nonTransparent <= 0 ||
					frame.opaque >= frame.total ||
					frame.bounds === null,
			),
		)
	) {
		throw new Error(
			"Kinetic hold fixtures did not render on a transparent overlay",
		);
	}
	if (
		kineticHolds.some(([, frames]) => frames.phaseA.hash === frames.phaseB.hash)
	) {
		throw new Error("Kinetic holds did not change across sampled phases");
	}
	if (
		new Set(kineticHolds.map(([, frames]) => frames.phaseA.hash)).size !== 6
	) {
		throw new Error("Kinetic holds collapsed to identical phase pixels");
	}
	const kineticEntrances = Object.entries(result.kineticEntrances);
	if (
		kineticEntrances.length !== 10 ||
		kineticEntrances.some(([, frames]) =>
			[frames.early, frames.settled].some(
				(frame) =>
					frame.nonTransparent <= 0 ||
					frame.opaque >= frame.total ||
					frame.bounds === null,
			),
		)
	) {
		throw new Error(
			"Kinetic entrance fixtures did not render on a transparent overlay",
		);
	}
	if (
		kineticEntrances.some(
			([, frames]) => frames.early.hash === frames.settled.hash,
		)
	) {
		throw new Error("Kinetic entrances did not change before settling");
	}
	if (
		new Set(kineticEntrances.map(([, frames]) => frames.early.hash)).size !== 10
	) {
		throw new Error("Kinetic entrances collapsed to identical early pixels");
	}
	const kineticExits = Object.entries(result.kineticExits);
	if (
		kineticExits.length !== 8 ||
		kineticExits.some(([, frames]) =>
			[frames.phaseA, frames.phaseB].some(
				(frame) =>
					frame.nonTransparent <= 0 ||
					frame.opaque >= frame.total ||
					frame.bounds === null,
			),
		)
	) {
		throw new Error(
			"Kinetic exit fixtures did not render on a transparent overlay",
		);
	}
	if (
		kineticExits.some(([, frames]) => frames.phaseA.hash === frames.phaseB.hash)
	) {
		throw new Error("Kinetic exits did not change across sampled phases");
	}
	if (
		new Set(kineticExits.map(([, frames]) => frames.phaseA.hash)).size !== 8
	) {
		throw new Error("Kinetic exits collapsed to identical phase pixels");
	}
	if (result.pipeline.preview.hash !== result.pipeline.export.hash) {
		throw new Error("Preview and export scene paths produced different pixels");
	}
	if (result.pipeline.preview.hash !== result.pipeline.repeated.hash) {
		throw new Error(
			"The compositor did not reproduce a prior motion-text frame",
		);
	}
	if (result.pipeline.preview.hash === result.pipeline.later.hash) {
		throw new Error(
			"The compositor did not upload changed pixels for a stable texture id",
		);
	}
	if (
		result.fontInspection.inspection !== null ||
		typeof result.fontInspection.error !== "string" ||
		!result.fontInspection.error.startsWith("invalid-font:")
	) {
		throw new Error("Rust font inspection did not fail closed in Chromium");
	}
	if (
		result.fontRuntime.inspection.contentDigest !==
			"sha256:bde046ddd9f20be35b0bd56cc79eb752b967fb6661a3fe76cb067bb09f871d76" ||
		result.fontRuntime.readyDiagnostics.length !== 0 ||
		result.fontRuntime.loadedBeforeInvalidate !== 1 ||
		result.fontRuntime.loadedAfterInvalidate !== 0 ||
		result.fontRuntime.loadedAfterReload !== 1 ||
		result.fontRuntime.loadedAfterDispose !== 0 ||
		result.fontRuntime.loads !== 2 ||
		result.fontRuntime.snapshot.cachedFonts !== 0 ||
		result.fontRuntime.snapshot.loadedFaces !== 0 ||
		result.fontRuntime.snapshot.disposed !== true
	) {
		throw new Error(
			"Project font ready/release/reload lifecycle was not stable",
		);
	}
	if (
		result.fontRuntime.builtin.digest !==
			"sha256:c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f" ||
		result.fontRuntime.builtin.diagnostics.length !== 0 ||
		result.fontRuntime.builtin.loads.length !== 1 ||
		result.fontRuntime.builtin.loads[0] !==
			"motion-text/fonts/noto-sans-jp-variable.ttf" ||
		result.fontRuntime.builtin.loadedBeforeDispose !== 1 ||
		result.fontRuntime.builtin.loadedAfterDispose !== 0
	) {
		throw new Error(
			"Offline JIZURA builtin font readiness or release was not stable",
		);
	}
	const missingGlyph = result.fontRuntime.missingDiagnostics.find(
		(diagnostic) => diagnostic.code === "missing-glyph",
	);
	if (
		missingGlyph?.severity !== "error" ||
		JSON.stringify(missingGlyph.codePoints) !== JSON.stringify([19990, 30028])
	) {
		throw new Error("Project font missing-glyph diagnostics were not exact");
	}
	if (
		result.plannerSupport.supportedPlan.plan === null ||
		result.plannerSupport.supportedPlan.plan.cuts.some(
			(cut) => cut.preset.enter === "unsupportedEnterFixture",
		) ||
		result.plannerSupport.rejectedPlan.plan !== null ||
		!result.plannerSupport.rejectedPlan.diagnostics.some(
			(diagnostic) => diagnostic.code === "unsupported-renderer-preset",
		)
	) {
		throw new Error(
			"Renderer support manifest was not enforced by the Rust planner",
		);
	}
	console.log(
		`probe-motion-text-renderer-browser: deterministic=${result.first.hash}, later=${result.later.hash}, seed=${result.otherSeed.hash}, ko=${result.koreanFrame.hash}, typography=${typographyFrames.map(([layout, frame]) => `${layout}:${frame.hash}`).join(",")}, entrances=${typographyEntrances.map(([enter, frames]) => `${enter}:${frames.early.hash}->${frames.settled.hash}`).join(",")}, enterBEntrances=${enterBEntrances.map(([enter, frames]) => `${enter}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}, enterAEntrances=${enterAEntrances.map(([enter, frames]) => `${enter}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}, holds=${typographyHolds.map(([hold, frames]) => `${hold}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}, exits=${typographyExits.map(([exit, frames]) => `${exit}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}, decors=${typographyDecors.map(([decor, frame]) => `${decor}:${frame.hash}`).join(",")}, treatments=${typographyTreatments.map(([treat, frame]) => `${treat}:${frame.hash}`).join(",")}, transitions=${typographyTransitions.map(([trans, frames]) => `${trans}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}, kineticDecors=${kineticDecors.map(([decor, frame]) => `${decor}:${frame.hash}`).join(",")}, kineticTreatments=${kineticTreatments.map(([treat, frame]) => `${treat}:${frame.hash}`).join(",")}, kineticTransitions=${kineticTransitions.map(([trans, frames]) => `${trans}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}, kineticCameras=${kineticCameras.map(([cam, frames]) => `${cam}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}, kineticHolds=${kineticHolds.map(([hold, frames]) => `${hold}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}, kineticEntrances=${kineticEntrances.map(([enter, frames]) => `${enter}:${frames.early.hash}->${frames.settled.hash}`).join(",")}, compositor=${result.pipeline.preview.hash}->${result.pipeline.later.hash}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: kineticExits=${kineticExits.map(([exit, frames]) => `${exit}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: kineticLayouts=${kineticLayouts.map(([layout, frames]) => `${layout}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: horrorStyles=${horrorStyles.map(([style, frame]) => `${style}:${frame.hash}`).join(",")};horrorLayouts=${horrorLayouts.map(([layout, frames]) => `${layout}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: catalogStyles=${catalogStyles.map(([style, frame]) => `${style}:${frame.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: horrorEntrances=${horrorEntrances.map(([enter, frames]) => `${enter}:${frames.early.hash}->${frames.settled.hash}`).join(",")};horrorHolds=${horrorHolds.map(([hold, frames]) => `${hold}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")};horrorExits=${horrorExits.map(([exit, frames]) => `${exit}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")};horrorTreatments=${horrorTreatments.map(([treat, frame]) => `${treat}:${frame.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: horrorDecors=${horrorDecors.map(([decor, frames]) => `${decor}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")};horrorBackgrounds=${horrorBackgrounds.map(([bg, frames]) => `${bg}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")};horrorCameras=${horrorCameras.map(([cam, frames]) => `${cam}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: bgcamBackgrounds=${bgcamBackgrounds.map(([bg, frames]) => `${bg}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")};bgcamCameras=${bgcamCameras.map(([cam, frames]) => `${cam}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: exitHoldHolds=${exitHoldHolds.map(([hold, frames]) => `${hold}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")};exitHoldExits=${exitHoldExits.map(([exit, frames]) => `${exit}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: exitBHolds=${exitBHolds.map(([hold, frames]) => `${hold}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")};exitBExits=${exitBExits.map(([exit, frames]) => `${exit}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: treatTransTreatments=${treatTransTreatments.map(([treat, frames]) => `${treat}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")};treatTransTransitions=${treatTransTransitions.map(([trans, frames]) => `${trans}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: coreDecors=${coreDecors.map(([decor, frames]) => `${decor}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: extendedDecors=${extendedDecors.map(([decor, frames]) => `${decor}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: decorB=${decorB.map(([decor, frames]) => `${decor}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: looksTreatments=${looksTreatments.map(([treat, frames]) => `${treat}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: looksBackgrounds=${looksBackgrounds.map(([bg, frames]) => `${bg}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")};looksCameras=${looksCameras.map(([cam, frames]) => `${cam}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: looksEffects=${looksEffects.map(([effect, frames]) => `${effect}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: horrorEffects=${horrorEffects.map(([effect, frames]) => `${effect}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")};horrorTransitions=${horrorTransitions.map(([trans, frames]) => `${trans}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: coreEffects=${coreEffects.map(([effect, frames]) => `${effect}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: fxBEffects=${fxBEffects.map(([effect, frames]) => `${effect}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: baselineStatic=styles(${baselineStyles.map(([style, frame]) => `${style}:${frame.hash}`).join(",")});layouts(${baselineLayouts.map(([layout, frame]) => `${layout}:${frame.hash}`).join(",")});treatments(${baselineTreatments.map(([treat, frame]) => `${treat}:${frame.hash}`).join(",")});backgrounds(${baselineBackgrounds.map(([bg, frame]) => `${bg}:${frame.hash}`).join(",")})`,
	);
	console.log(
		`probe-motion-text-renderer-browser: coreLayouts=${coreLayouts.map(([layout, frames]) => `${layout}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: layoutsA=${layoutsA.map(([layout, frames]) => `${layout}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: layoutsB=${layoutsB.map(([layout, frames]) => `${layout}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: layoutsC=${layoutsC.map(([layout, frames]) => `${layout}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: layoutsD=${layoutsD.map(([layout, frames]) => `${layout}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: baselineMotion=entrances(${baselineEntrances.map(([enter, frames]) => `${enter}:${frames.early.hash}->${frames.settled.hash}`).join(",")});holds(${baselineHolds.map(([hold, frames]) => `${hold}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")});exits(${baselineExits.map(([exit, frames]) => `${exit}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")});cameras(${baselineCameras.map(([cam, frames]) => `${cam}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")})`,
	);
	console.log(
		`probe-motion-text-renderer-browser: coreAnimEntrances=${coreAnimEntrances.map(([enter, frames]) => `${enter}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")};coreAnimHolds=${coreAnimHolds.map(([hold, frames]) => `${hold}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")};coreAnimExits=${coreAnimExits.map(([exit, frames]) => `${exit}:${frames.phaseA.hash}->${frames.phaseB.hash}`).join(",")}`,
	);
	console.log(
		`probe-motion-text-renderer-browser: variantMatrix=${variantFamilies.length}x${variantScenarios.length};distinct=${variantFamilies.map(([group, frames]) => `${group}:${new Set(Object.values(frames).map((frame) => frame.hash)).size}`).join(",")}`,
	);
} finally {
	await browser?.close();
	await server.close();
}
