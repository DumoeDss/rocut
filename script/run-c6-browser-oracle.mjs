import { chromium } from "@playwright/test";

const baseUrl = process.env.C6_BROWSER_BASE_URL;
if (!baseUrl) throw new Error("C6_BROWSER_BASE_URL is required");

// The default Playwright headless shell can be unavailable on a developer
// machine that already has many long-lived shell processes. An explicit
// executable keeps the evidence runner deterministic without changing the
// production browser path.
const browser = await chromium.launch({
	headless: true,
	...(process.env.C6_BROWSER_EXECUTABLE_PATH
		? { executablePath: process.env.C6_BROWSER_EXECUTABLE_PATH }
		: {}),
});
try {
	const observations = [];
	for (const control of ["ordinary", "missing-created", "leak"]) {
		const page = await browser.newPage();
		const consoleErrors = [];
		const expectedRevocationFailures = [];
		const pageErrors = [];
		page.on("console", (message) => {
			if (message.type() !== "error") return;
			const location = message.location().url;
			// The harness deliberately fetches each blob URL once after session
			// disposal. Chromium reports that expected revoke failure as a console
			// network error even though the rejection is caught by the probe.
			if (
				message.text().includes("net::ERR_FILE_NOT_FOUND") &&
				location.startsWith("blob:")
			) {
				expectedRevocationFailures.push({ text: message.text(), location });
				return;
			}
			consoleErrors.push(message.text());
		});
		page.on("pageerror", (error) => pageErrors.push(error.message));
		const url = new URL(baseUrl);
		url.searchParams.set("c6-disposal-harness", "1");
		url.searchParams.set("control", control);
		await page.goto(url.toString(), {
			waitUntil: "domcontentloaded",
			timeout: 90_000,
		});
		await page.waitForSelector(
			'[data-testid="c6-disposal-harness"][data-status="ready"], [data-testid="c6-disposal-harness"][data-status="error"]',
			{
				timeout: 90_000,
			},
		);
		const harness = page.locator('[data-testid="c6-disposal-harness"]');
		const reportText = await page
			.locator('[data-testid="c6-disposal-report"]')
			.textContent();
		const result = reportText ? JSON.parse(reportText) : null;
		const errorText = await page
			.locator('[data-testid="c6-disposal-error"]')
			.textContent()
			.catch(() => null);
		const observation = {
			control,
			status: await harness.getAttribute("data-status"),
			marker: await harness.getAttribute("data-c6-build-marker"),
			c5HostStore: await harness.getAttribute("data-c5-host-store"),
			audioFallback: await harness.getAttribute("data-audio-fallback"),
			clean: result?.clean ?? null,
			error: errorText,
			failures: result?.failures ?? [],
			residualSeries: result?.residualSeries ?? null,
			cycles: result?.cycles ?? null,
			expectedRevocationFailures,
			consoleErrors,
			pageErrors,
		};
		observations.push(observation);
		console.log(JSON.stringify(observation));
		await page.close();
	}
	const expectedMarker = process.env.C6_EXPECTED_BUILD_MARKER;
	const markerSet = new Set(observations.map((entry) => entry.marker));
	if (
		markerSet.size !== 1 ||
		[...markerSet][0] == null ||
		[...markerSet][0] === ""
	) {
		throw new Error("C6 build marker identity was not stable across controls.");
	}
	if (expectedMarker && [...markerSet][0] !== expectedMarker) {
		throw new Error(
			`C6 build marker mismatch: expected ${expectedMarker}, received ${[...markerSet][0]}.`,
		);
	}
	for (const observation of observations) {
		if (observation.status !== "ready") {
			throw new Error(
				`C6 ${observation.control} harness did not become ready: ${observation.error ?? "unknown error"}`,
			);
		}
		if (observation.c5HostStore !== "BrowserProjectStore") {
			throw new Error(
				`C6 ${observation.control} did not use BrowserProjectStore.`,
			);
		}
		if (observation.audioFallback !== "false") {
			throw new Error(`C6 ${observation.control} used an audio fallback.`);
		}
		if (observation.consoleErrors.length || observation.pageErrors.length) {
			throw new Error(`C6 ${observation.control} emitted console/page errors.`);
		}
		if (!Array.isArray(observation.cycles) || observation.cycles.length !== 6) {
			throw new Error(`C6 ${observation.control} did not execute six cycles.`);
		}
		if (
			observation.cycles.some(
				(cycle) =>
					!cycle.lifecycle?.sameEditor ||
					!cycle.lifecycle.rootMountedDuringSuspend ||
					!cycle.lifecycle.rootMountedAfterResume ||
					!cycle.lifecycle.postResumeOperation,
			)
		) {
			throw new Error(
				`C6 ${observation.control} suspend/resume evidence is incomplete.`,
			);
		}
		if (
			observation.cycles.some((cycle) => {
				const dwell = cycle.platformProof?.suspendedDwell;
				if (!dwell?.postResumeActivity) return true;
				return (
					dwell.renderPublicationsBefore !== dwell.renderPublicationsAfter ||
					dwell.timerResourcesCreatedBefore !==
						dwell.timerResourcesCreatedAfter ||
					dwell.rendererBeforeSuspend.generation == null ||
					dwell.rendererAfterResume.generation == null ||
					dwell.rendererAfterResume.generation <=
						dwell.rendererBeforeSuspend.generation ||
					dwell.rendererBeforeSuspend.resourceId == null ||
					dwell.rendererAfterResume.resourceId == null ||
					dwell.rendererBeforeSuspend.resourceId ===
						dwell.rendererAfterResume.resourceId ||
					dwell.rendererAfterResume.publications <=
						dwell.rendererDwellAfter.publications
				);
			})
		) {
			throw new Error(
				`C6 ${observation.control} retained renderer resume evidence is incomplete.`,
			);
		}
	}
	const ordinary = observations.find((entry) => entry.control === "ordinary");
	if (!ordinary?.clean) throw new Error("C6 ordinary control was not clean.");
	const missing = observations.find(
		(entry) => entry.control === "missing-created",
	);
	if (
		missing?.clean ||
		!missing?.failures.some((failure) =>
			failure.includes("worker was not CREATED"),
		)
	) {
		throw new Error(
			"C6 missing-created control did not fail on missing worker creation.",
		);
	}
	const leak = observations.find((entry) => entry.control === "leak");
	if (
		leak?.clean ||
		!leak?.failures.some(
			(failure) =>
				failure.includes("independent platform residual") ||
				failure.includes("gpuResource platform residual"),
		)
	) {
		throw new Error(
			"C6 leak control did not fail on an independent platform residual.",
		);
	}
} finally {
	await browser.close();
}
