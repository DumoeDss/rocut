import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

import type { DisposalReport } from "@opencut/editor-classic/session";

import { evidenceDestination } from "./evidence-path";
import { HOST } from "./host-profile";
import { runR2Evidence } from "./surface-r2-evidence";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const EVIDENCE_DIR = evidenceDestination({
	repoRoot: REPO_ROOT,
	change: "s0304-surface-css-react-a11y",
	leaf: `browser-surface/${HOST}`,
}).dir;

interface StepEvidence {
	readonly id: string;
	readonly asserted: string[];
	readonly captured: string[];
	error: string | null;
}

interface OutsideSnapshot {
	readonly html: ElementSnapshot;
	readonly body: ElementSnapshot;
	readonly chrome: ElementSnapshot;
	readonly before: ElementSnapshot;
	readonly after: ElementSnapshot;
}

interface ElementSnapshot {
	readonly bounds: Record<string, number>;
	readonly style: Record<string, string>;
}

interface LedgerEntry {
	readonly sequence: number;
	readonly surface: string;
	readonly kind: string;
	readonly detail: unknown;
}

interface SurfaceLedger {
	readonly schema: string;
	readonly host: string;
	readonly actionStates: {
		readonly primaryPlaying: boolean | null;
		readonly secondaryPlaying: boolean | null;
	};
	readonly calls: LedgerEntry[];
	readonly errors: LedgerEntry[];
	readonly resources: LedgerEntry[];
	readonly disposals: LedgerEntry[];
}

interface ResourcePhase {
	readonly report: Record<string, { created: number; released: number }>;
	readonly activity: {
		readonly frames: number;
		readonly generation: number | null;
		readonly resourceId: string | null;
	};
}

const steps: StepEvidence[] = [];
const measurements: Record<string, unknown> = {};

function begin(id: string): StepEvidence {
	const evidence: StepEvidence = {
		id,
		asserted: [],
		captured: [],
		error: null,
	};
	steps.push(evidence);
	return evidence;
}

async function capture(
	page: Page,
	step: StepEvidence,
	name: string,
): Promise<void> {
	const file = `${name}.png`;
	await page.screenshot({ path: resolve(EVIDENCE_DIR, file), fullPage: true });
	step.captured.push(file);
}

async function runStep(
	step: StepEvidence,
	body: () => Promise<void>,
): Promise<void> {
	try {
		await body();
	} catch (error) {
		step.error = error instanceof Error ? error.message : String(error);
	}
}

async function readLedger(page: Page): Promise<SurfaceLedger> {
	const text = await page.getByTestId("surface-evidence-ledger").textContent();
	if (!text) throw new Error("Surface evidence ledger is empty.");
	return JSON.parse(text) as SurfaceLedger;
}

async function waitForCall(
	page: Page,
	kind: string,
	minimum = 1,
): Promise<SurfaceLedger> {
	await expect
		.poll(
			async () =>
				(await readLedger(page)).calls.filter((e) => e.kind === kind).length,
		)
		.toBeGreaterThanOrEqual(minimum);
	return readLedger(page);
}

async function outsideSnapshot(page: Page): Promise<OutsideSnapshot> {
	return page.evaluate(() => {
		const snapshot = (element: Element) => {
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return {
				bounds: {
					x: rect.x,
					y: rect.y,
					width: rect.width,
					height: rect.height,
				},
				style: {
					display: style.display,
					position: style.position,
					overflow: style.overflow,
					backgroundColor: style.backgroundColor,
					color: style.color,
					fontFamily: style.fontFamily,
					fontSize: style.fontSize,
					lineHeight: style.lineHeight,
					boxSizing: style.boxSizing,
					pointerEvents: style.pointerEvents,
				},
			};
		};
		const required = (testId: string) => {
			const element = document.querySelector(`[data-testid="${testId}"]`);
			if (!element) throw new Error(`Missing outside snapshot node ${testId}.`);
			return element;
		};
		return {
			html: snapshot(document.documentElement),
			body: snapshot(document.body),
			chrome: snapshot(required("surface-host-chrome")),
			before: snapshot(required("outside-before")),
			after: snapshot(required("outside-after")),
		};
	});
}

async function dispatchProbe(
	page: Page,
	target: "surface" | "outside",
	type: "pointerdown" | "wheel" | "space",
): Promise<{ defaultPrevented: boolean; active: string | null }> {
	return page.evaluate(
		({ targetName, eventType }) => {
			const target =
				targetName === "surface"
					? document.querySelector<HTMLElement>(
							'[data-editor-surface="r1-evidence-primary"]:not([data-editor-surface-portal])',
						)
					: document.querySelector<HTMLElement>(
							'[data-testid="outside-before"]',
						);
			if (!target) throw new Error(`Missing ${targetName} probe target.`);
			let event: Event;
			if (eventType === "pointerdown") {
				event = new PointerEvent("pointerdown", {
					bubbles: true,
					cancelable: true,
					button: 0,
					isPrimary: true,
				});
			} else if (eventType === "wheel") {
				event = new WheelEvent("wheel", {
					bubbles: true,
					cancelable: true,
					deltaY: 40,
				});
			} else {
				target.focus();
				event = new KeyboardEvent("keydown", {
					bubbles: true,
					cancelable: true,
					key: " ",
					code: "Space",
				});
			}
			target.dispatchEvent(event);
			return {
				defaultPrevented: event.defaultPrevented,
				active:
					document.activeElement instanceof HTMLElement
						? (document.activeElement.getAttribute("data-testid") ??
							document.activeElement.getAttribute("data-surface-tab-probe") ??
							document.activeElement.getAttribute("data-editor-surface"))
						: null,
			};
		},
		{ targetName: target, eventType: type },
	);
}

function resourcePhase(ledger: SurfaceLedger, phase: string): ResourcePhase {
	const entry = [...ledger.resources]
		.reverse()
		.find(
			(candidate) =>
				(candidate.detail as { phase?: string } | null)?.phase === phase,
		);
	if (!entry) throw new Error(`Missing resource phase ${phase}.`);
	return entry.detail as ResourcePhase;
}

test.describe.configure({ mode: "serial" });

test(`Surface matrix and lifecycle — ${HOST} host`, async ({ page }) => {
	mkdirSync(EVIDENCE_DIR, { recursive: true });
	steps.length = 0;
	for (const key of Object.keys(measurements)) delete measurements[key];
	const consoleErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) =>
		consoleErrors.push(`pageerror: ${error.message}`),
	);
	await page.addInitScript(() => {
		localStorage.setItem("hasSeenOnboarding", "true");
	});

	try {
		const boot = begin("boot-unmounted-baseline");
		await runStep(boot, async () => {
			await page.goto(
				HOST === "next" ? "/surface-evidence" : "/surface-evidence.html",
			);
			const harness = page.getByTestId("surface-evidence-harness");
			await expect(harness).toHaveAttribute("data-host", HOST);
			await expect(harness).toHaveAttribute("data-status", "ready", {
				timeout: 180_000,
			});
			await expect(
				page.locator("[data-editor-surface]:not([data-editor-surface-portal])"),
			).toHaveCount(0);
			measurements.beforeMount = await outsideSnapshot(page);
			boot.asserted.push(
				"shared harness loaded with a real prepared session and no mounted Surface",
			);
		});
		await capture(page, boot, "01-unmounted-baseline");

		const slowReady = begin("slow-ready-unmount-remount");
		await runStep(slowReady, async () => {
			await page.getByTestId("mount-primary").click();
			const surface = page.locator(
				'[data-editor-surface="r1-evidence-primary"]:not([data-editor-surface-portal])',
			);
			await expect(surface).toBeVisible();
			let ledger = await waitForCall(page, "underlying-ready");
			expect(
				ledger.calls.filter((entry) => entry.kind === "on-ready"),
			).toHaveLength(0);
			await surface.evaluate((node) => {
				Reflect.set(window, "__r1RetiredSurface", node);
			});
			await page.getByTestId("unmount-primary").click();
			await expect(surface).toHaveCount(0);
			await page.getByTestId("release-readiness").click();
			await page.waitForTimeout(100);
			ledger = await readLedger(page);
			expect(
				ledger.calls.filter((entry) => entry.kind === "on-ready"),
			).toHaveLength(0);
			const retired = await page.evaluate(() => {
				const node = Reflect.get(window, "__r1RetiredSurface") as HTMLElement;
				const wheel = new WheelEvent("wheel", {
					bubbles: true,
					cancelable: true,
				});
				const key = new KeyboardEvent("keydown", {
					key: " ",
					code: "Space",
					bubbles: true,
					cancelable: true,
				});
				node.dispatchEvent(wheel);
				node.dispatchEvent(key);
				return { wheel: wheel.defaultPrevented, key: key.defaultPrevented };
			});
			expect(retired).toEqual({ wheel: false, key: false });
			await page.getByTestId("mount-primary").click();
			await expect(surface).toBeVisible();
			ledger = await waitForCall(page, "on-ready");
			const mounts = ledger.calls.filter((entry) => entry.kind === "mount");
			expect(mounts.at(-1)?.detail).toMatchObject({
				targetIsSurface: true,
				containerTestId: "primary-container",
			});
			slowReady.asserted.push(
				"unmount-before-ready suppressed stale publication; remount became ready; retired listeners were removed",
			);
		});
		await capture(page, slowReady, "02-remounted-ready");

		const bounded = begin("bounded-container-and-outside-style");
		await runStep(bounded, async () => {
			const bounds = await page.evaluate(() => {
				const container = document.querySelector<HTMLElement>(
					'[data-testid="primary-container"]',
				);
				const surface = document.querySelector<HTMLElement>(
					'[data-editor-surface="r1-evidence-primary"]:not([data-editor-surface-portal])',
				);
				if (!container || !surface)
					throw new Error("Missing bounded Surface nodes.");
				const outer = container.getBoundingClientRect();
				const inner = surface.getBoundingClientRect();
				const style = getComputedStyle(container);
				return {
					container: {
						x: outer.x,
						y: outer.y,
						width: outer.width,
						height: outer.height,
					},
					surface: {
						x: inner.x,
						y: inner.y,
						width: inner.width,
						height: inner.height,
					},
					border: {
						left: Number.parseFloat(style.borderLeftWidth),
						right: Number.parseFloat(style.borderRightWidth),
						top: Number.parseFloat(style.borderTopWidth),
						bottom: Number.parseFloat(style.borderBottomWidth),
					},
					viewport: { width: window.innerWidth, height: window.innerHeight },
				};
			});
			measurements.bounds = bounds;
			expect(bounds.surface.x).toBeCloseTo(
				bounds.container.x + bounds.border.left,
				1,
			);
			expect(bounds.surface.y).toBeCloseTo(
				bounds.container.y + bounds.border.top,
				1,
			);
			expect(bounds.surface.width).toBeCloseTo(
				bounds.container.width - bounds.border.left - bounds.border.right,
				1,
			);
			expect(bounds.surface.height).toBeCloseTo(
				bounds.container.height - bounds.border.top - bounds.border.bottom,
				1,
			);
			expect(bounds.surface.width).not.toBe(bounds.viewport.width);
			expect(bounds.surface.height).not.toBe(bounds.viewport.height);
			measurements.afterMount = await outsideSnapshot(page);
			expect(measurements.afterMount).toEqual(measurements.beforeMount);
			bounded.asserted.push(
				"Surface filled the bounded content box, not the viewport, with zero outside style/bounds delta",
			);
		});

		const passive = begin("passive-controlled-request");
		await runStep(passive, async () => {
			const surface = page.locator(
				'[data-editor-surface="r1-evidence-primary"]:not([data-editor-surface-portal])',
			);
			await expect(surface).toHaveAttribute("tabindex", "-1");
			const pointer = await dispatchProbe(page, "surface", "pointerdown");
			const wheel = await dispatchProbe(page, "surface", "wheel");
			expect(pointer.defaultPrevented).toBe(false);
			expect(wheel.defaultPrevented).toBe(false);
			const ledger = await waitForCall(page, "focus-mode-request");
			expect(ledger.calls.at(-1)?.detail).toMatchObject({
				requested: "focused",
				effective: "passive",
			});
			await expect(surface).toHaveAttribute("tabindex", "-1");
			passive.asserted.push(
				"passive input remained unclaimed and its focused request stayed advisory",
			);
		});

		const focused = begin("focused-local-input-and-outside-control");
		await runStep(focused, async () => {
			await page.getByTestId("mode-focused").click();
			const surface = page.locator(
				'[data-editor-surface="r1-evidence-primary"]:not([data-editor-surface-portal])',
			);
			await expect(surface).toHaveAttribute("tabindex", "0");
			await expect(surface.getByText("Loading project...")).toHaveCount(0, {
				timeout: 120_000,
			});
			const pointer = await dispatchProbe(page, "surface", "pointerdown");
			const wheel = await dispatchProbe(page, "surface", "wheel");
			const shortcut = await dispatchProbe(page, "surface", "space");
			const outsideWheel = await dispatchProbe(page, "outside", "wheel");
			const outsideShortcut = await dispatchProbe(page, "outside", "space");
			expect(pointer.active).toBe("r1-evidence-primary");
			expect(wheel.defaultPrevented).toBe(true);
			expect(shortcut.defaultPrevented).toBe(true);
			expect(outsideWheel.defaultPrevented).toBe(false);
			expect(outsideShortcut.defaultPrevented).toBe(false);
			expect((await readLedger(page)).actionStates.primaryPlaying).toBe(true);
			const resetShortcut = await dispatchProbe(page, "surface", "space");
			expect(resetShortcut.defaultPrevented).toBe(true);
			await expect
				.poll(async () => (await readLedger(page)).actionStates.primaryPlaying)
				.toBe(false);
			measurements.afterFocus = await outsideSnapshot(page);
			expect(measurements.afterFocus).toEqual(measurements.beforeMount);
			focused.asserted.push(
				"focused pointer, wheel, and shortcut ownership stayed local while outside events remained available",
			);
		});

		const full = begin("full-dynamic-tab-cycle");
		await runStep(full, async () => {
			await page.getByTestId("mode-full").click();
			const surface = page.locator(
				'[data-editor-surface="r1-evidence-primary"]:not([data-editor-surface-portal])',
			);
			await surface.evaluate((root) => {
				for (const child of [...root.children]) child.setAttribute("inert", "");
				for (const name of ["first", "last"]) {
					const button = document.createElement("button");
					button.type = "button";
					button.textContent = name;
					button.setAttribute("data-surface-tab-probe", name);
					root.append(button);
				}
				const disabled = document.createElement("button");
				disabled.disabled = true;
				disabled.setAttribute("data-surface-tab-probe", "disabled");
				root.append(disabled);
				const hidden = document.createElement("button");
				hidden.hidden = true;
				hidden.setAttribute("data-surface-tab-probe", "hidden");
				root.append(hidden);
				const negative = document.createElement("button");
				negative.tabIndex = -1;
				negative.setAttribute("data-surface-tab-probe", "negative");
				root.append(negative);
			});
			await surface.focus();
			await page.keyboard.press("Tab");
			await expect(
				page.locator('[data-surface-tab-probe="first"]'),
			).toBeFocused();
			await page.locator('[data-surface-tab-probe="last"]').focus();
			await page.keyboard.press("Tab");
			await expect(
				page.locator('[data-surface-tab-probe="first"]'),
			).toBeFocused();
			await page.keyboard.press("Shift+Tab");
			await expect(
				page.locator('[data-surface-tab-probe="last"]'),
			).toBeFocused();
			await surface.evaluate((root) => {
				const dynamic = document.createElement("button");
				dynamic.type = "button";
				dynamic.textContent = "dynamic";
				dynamic.setAttribute("data-surface-tab-probe", "dynamic");
				root.append(dynamic);
				dynamic.focus();
			});
			await page.keyboard.press("Tab");
			await expect(
				page.locator('[data-surface-tab-probe="first"]'),
			).toBeFocused();
			await surface.evaluate((root) => {
				for (const probe of root.querySelectorAll("[data-surface-tab-probe]")) {
					probe.remove();
				}
				for (const child of [...root.children]) child.removeAttribute("inert");
			});
			full.asserted.push(
				"full mode cycled the current eligible descendants and excluded disabled/hidden/negative controls",
			);
		});
		await capture(page, full, "03-focus-matrix");

		const multiple = begin("two-sessions-two-roots");
		await runStep(multiple, async () => {
			await page.getByTestId("mount-secondary").click();
			await expect(
				page.locator("[data-editor-surface]:not([data-editor-surface-portal])"),
			).toHaveCount(2);
			await waitForCall(page, "on-ready", 2);
			const secondarySurface = page.locator(
				'[data-editor-surface="r1-evidence-secondary"]:not([data-editor-surface-portal])',
			);
			await expect(
				secondarySurface.getByText("Loading project..."),
			).toHaveCount(0, { timeout: 120_000 });
			const ledger = await readLedger(page);
			const targets = ledger.calls
				.filter((entry) => entry.kind === "mount")
				.map(
					(entry) =>
						(entry.detail as { containerTestId?: string }).containerTestId,
				);
			expect(targets).toContain("primary-container");
			expect(targets).toContain("secondary-container");
			const focus = await secondarySurface.evaluate((node) => {
				node.dispatchEvent(
					new PointerEvent("pointerdown", {
						bubbles: true,
						cancelable: true,
						button: 0,
						isPrimary: true,
					}),
				);
				return document.activeElement === node;
			});
			expect(focus).toBe(true);
			const beforeAction = await readLedger(page);
			const beforeActionCalls = beforeAction.calls.filter(
				(entry) => entry.kind === "playback-toggle",
			).length;
			expect(beforeAction.actionStates.primaryPlaying).toBe(false);
			expect(beforeAction.actionStates.secondaryPlaying).toBe(false);
			await page.keyboard.press("Space");
			await expect
				.poll(
					async () =>
						(await readLedger(page)).calls.filter(
							(entry) => entry.kind === "playback-toggle",
						).length,
				)
				.toBe(beforeActionCalls + 1);
			const afterAction = await readLedger(page);
			const actionDelta = afterAction.calls
				.filter((entry) => entry.kind === "playback-toggle")
				.slice(beforeActionCalls);
			expect(actionDelta.map((entry) => entry.surface)).toEqual(["secondary"]);
			expect(afterAction.actionStates.primaryPlaying).toBe(false);
			expect(afterAction.actionStates.secondaryPlaying).toBe(true);
			multiple.asserted.push(
				"an effectful Space shortcut changed only the focused real session; the other session state and handler count stayed unchanged",
			);
		});
		const r2 = begin("r2-css-portal-react-a11y-error-resize-drag");
		await runStep(r2, async () => {
			const result = await runR2Evidence(page);
			expect(result.assertions.length).toBeGreaterThan(0);
			measurements.r2 = result;
			measurements.afterR2 = await outsideSnapshot(page);
			expect(measurements.afterR2).toEqual(measurements.beforeMount);
			r2.asserted.push(...result.assertions);
			r2.asserted.push(
				"html/body/chrome/sentinels retained their declared styles and bounds after portal, resize, drag, and error phases",
			);
		});
		const residualDialog = page.getByTestId(
			"r2-owned-dialog-r1-evidence-primary",
		);
		if ((await residualDialog.count()) > 0) {
			await page.keyboard.press("Escape");
			await expect(residualDialog).toHaveCount(0);
		}
		await capture(page, r2, "04-r2-final-evidence");
		await page.getByTestId("unmount-secondary").click();

		const visibilityStep = begin("visibility-resource-ledger");
		await runStep(visibilityStep, async () => {
			await page.getByTestId("visibility-hidden").click();
			let ledger = await waitForCall(page, "suspend-settled");
			const beforeSuspend = resourcePhase(ledger, "before-suspend");
			const afterSuspend = resourcePhase(ledger, "after-suspend");
			expect(beforeSuspend.report.timer.created).toBeGreaterThan(
				beforeSuspend.report.timer.released,
			);
			expect(beforeSuspend.report.worker.created).toBeGreaterThan(
				beforeSuspend.report.worker.released,
			);
			expect(afterSuspend.report.timer.released).toBe(
				afterSuspend.report.timer.created,
			);
			expect(afterSuspend.report.worker.released).toBe(
				afterSuspend.report.worker.created,
			);
			await page.getByTestId("visibility-visible").click();
			ledger = await waitForCall(page, "resume-settled");
			const afterResume = resourcePhase(ledger, "after-resume");
			expect(afterResume.report.timer.created).toBeGreaterThan(
				afterSuspend.report.timer.created,
			);
			expect(afterResume.activity.generation).toBeGreaterThan(
				afterSuspend.activity.generation ?? -1,
			);
			const lifecycleCalls = ledger.calls
				.filter((entry) => /(?:suspend|resume)-call/.test(entry.kind))
				.map((entry) => entry.kind);
			expect(lifecycleCalls).toEqual(["suspend-call", "resume-call"]);
			measurements.afterHideShow = await outsideSnapshot(page);
			expect(measurements.afterHideShow).toEqual(measurements.beforeMount);
			measurements.resourceLedger = ledger.resources;
			visibilityStep.asserted.push(
				"hidden drained real RAF/Worker activity through session.suspend; resume alone reopened a fresh RAF generation",
			);
		});
		await capture(page, visibilityStep, "04-visible-after-resource-resume");

		const cleanup = begin("listener-cleanup-and-host-disposal-cycles");
		await runStep(cleanup, async () => {
			const surface = page.locator(
				'[data-editor-surface="r1-evidence-primary"]:not([data-editor-surface-portal])',
			);
			await surface.evaluate((node) => {
				Reflect.set(window, "__r1RetiredSurface", node);
			});
			await page.getByTestId("unmount-primary").click();
			await expect(surface).toHaveCount(0);
			const retired = await page.evaluate(() => {
				const node = Reflect.get(window, "__r1RetiredSurface") as HTMLElement;
				const wheel = new WheelEvent("wheel", {
					bubbles: true,
					cancelable: true,
				});
				const key = new KeyboardEvent("keydown", {
					key: " ",
					code: "Space",
					bubbles: true,
					cancelable: true,
				});
				node.dispatchEvent(wheel);
				node.dispatchEvent(key);
				return { wheel: wheel.defaultPrevented, key: key.defaultPrevented };
			});
			expect(retired).toEqual({ wheel: false, key: false });
			measurements.afterUnmount = await outsideSnapshot(page);
			expect(measurements.afterUnmount).toEqual(measurements.beforeMount);

			for (const expectedCycle of [2, 3]) {
				await page.getByTestId("dispose-primary").click();
				await expect(
					page.getByTestId("surface-evidence-harness"),
				).toHaveAttribute("data-cycle", String(expectedCycle), {
					timeout: 180_000,
				});
				if (expectedCycle === 2) {
					await page.getByTestId("mount-primary").click();
					await expect(surface).toBeVisible();
					await page.getByTestId("unmount-primary").click();
					await expect(surface).toHaveCount(0);
				}
			}
			const ledger = await readLedger(page);
			const hostDisposals = ledger.calls.filter(
				(entry) => entry.kind === "host-disposed-primary",
			);
			expect(hostDisposals).toHaveLength(2);
			for (const disposal of hostDisposals) {
				const report = (disposal.detail as { report: DisposalReport }).report;
				for (const resourceClass of [
					"timer",
					"worker",
					"audioContext",
					"objectUrl",
					"gpuResource",
				] as const) {
					expect(report[resourceClass].released).toBe(
						report[resourceClass].created,
					);
				}
			}
			expect(
				ledger.calls.filter((entry) => entry.kind === "dispose-call"),
			).toHaveLength(2);
			measurements.callLedger = ledger.calls;
			cleanup.asserted.push(
				"unmount removed Surface listeners without disposal; two explicit Host cycles released every registered resource",
			);
		});
		await capture(page, cleanup, "05-host-disposal-cycles");
	} finally {
		const ledger = await readLedger(page).catch(() => null);
		writeFileSync(
			resolve(EVIDENCE_DIR, `ledger-${HOST}.json`),
			`${JSON.stringify(
				{
					host: HOST,
					generatedAt: new Date().toISOString(),
					steps,
					consoleErrors,
					ledger,
				},
				null,
				2,
			)}\n`,
		);
		writeFileSync(
			resolve(EVIDENCE_DIR, `measurements-${HOST}.json`),
			`${JSON.stringify(measurements, null, 2)}\n`,
		);
	}

	const unevidenced = steps.filter(
		(step) => step.asserted.length === 0 && step.captured.length === 0,
	);
	expect(
		unevidenced.map((step) => step.id),
		"every Surface step must carry an assertion or capture",
	).toEqual([]);
	const failed = steps.filter((step) => step.error !== null);
	expect(
		failed.map((step) => `${step.id}: ${step.error}`),
		"no Surface matrix/lifecycle step may fail",
	).toEqual([]);
	const unexpectedConsoleErrors = consoleErrors.filter(
		(message) => !message.includes("R2 deterministic render failure"),
	);
	expect(
		unexpectedConsoleErrors,
		"no unexpected browser console/page error may survive R2 evidence",
	).toEqual([]);
});

test(`S02 disposal oracle remains green — ${HOST} host`, async ({ page }) => {
	const oraclePath =
		HOST === "next"
			? "/c6-disposal?control=ordinary"
			: "/?c6-disposal-harness=1&control=ordinary";
	await page.goto(oraclePath);
	const harness = page.getByTestId("c6-disposal-harness");
	await expect(harness).toHaveAttribute("data-status", "ready", {
		timeout: 12 * 60 * 1000,
	});
	const text = await page.getByTestId("c6-disposal-report").textContent();
	if (!text) throw new Error("C6 disposal oracle produced no report.");
	const report = JSON.parse(text) as { clean?: boolean; failures?: unknown[] };
	writeFileSync(
		resolve(EVIDENCE_DIR, `s02-disposal-oracle-${HOST}.json`),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	expect(report.clean).toBe(true);
	expect(report.failures ?? []).toEqual([]);
	await page.screenshot({
		path: resolve(EVIDENCE_DIR, "06-s02-disposal-oracle.png"),
		fullPage: true,
	});
});
