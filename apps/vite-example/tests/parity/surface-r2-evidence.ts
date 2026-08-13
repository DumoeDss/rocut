import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

interface LedgerEntry {
	readonly kind: string;
	readonly surface: string;
	readonly detail: unknown;
}

interface R2Ledger {
	readonly schema: string;
	readonly buildMarker: string;
	readonly reactIdentity: {
		readonly identity: boolean;
		readonly context: boolean;
		readonly state: boolean;
		readonly effect: boolean;
	} | null;
	readonly calls: LedgerEntry[];
}

export interface R2EvidenceResult {
	readonly assertions: string[];
	readonly axe: Record<string, unknown>;
	readonly resize: unknown[];
	readonly drag: unknown;
}

const PRIMARY =
	'[data-editor-surface="r1-evidence-primary"]:not([data-editor-surface-portal])';
const SECONDARY =
	'[data-editor-surface="r1-evidence-secondary"]:not([data-editor-surface-portal])';

async function ledger(page: Page): Promise<R2Ledger> {
	const text = await page.getByTestId("surface-evidence-ledger").textContent();
	if (!text) throw new Error("R2 ledger is missing.");
	return JSON.parse(text) as R2Ledger;
}

async function ownedSnapshot(page: Page) {
	return page.evaluate(
		({ primary }) => {
			const read = (element: Element) => {
				const style = getComputedStyle(element);
				const bounds = element.getBoundingClientRect();
				return {
					bounds: {
						x: bounds.x,
						y: bounds.y,
						width: bounds.width,
						height: bounds.height,
					},
					style: {
						contain: style.contain,
						isolation: style.isolation,
						position: style.position,
						overflow: style.overflow,
						background: style.getPropertyValue("--background"),
						foreground: style.getPropertyValue("--foreground"),
					},
				};
			};
			const root = document.querySelector(primary);
			const portal = root?.querySelector("[data-editor-surface-portal]");
			if (!root || !portal) throw new Error("Missing owned R2 roots.");
			return { root: read(root), portal: read(portal) };
		},
		{ primary: PRIMARY },
	);
}

async function axeOwned(page: Page, selector: string) {
	const result = await new AxeBuilder({ page })
		.include(selector)
		.withTags(["wcag2a", "wcag2aa"])
		.analyze();
	const serious = result.violations.filter(
		(violation) =>
			violation.impact === "critical" || violation.impact === "serious",
	);
	expect(
		result.passes.length + result.incomplete.length + result.violations.length,
	).toBeGreaterThan(0);
	expect(serious, `serious/critical owned violations for ${selector}`).toEqual(
		[],
	);
	return {
		selector,
		rules:
			result.passes.length +
			result.incomplete.length +
			result.violations.length,
		violations: result.violations,
	};
}

export async function runR2Evidence(page: Page): Promise<R2EvidenceResult> {
	const assertions: string[] = [];
	await page.getByTestId("r2-react-state-probe").dispatchEvent("click");
	await expect
		.poll(async () => (await ledger(page)).reactIdentity?.state)
		.toBe(true);
	const current = await ledger(page);
	expect(current.schema).toBe("r2-surface-evidence-v1");
	const expectedBuildMarker = process.env.R2_EXPECTED_BUILD_MARKER;
	expect(
		expectedBuildMarker,
		"the R2 run must declare its final build marker",
	).toBeTruthy();
	expect(current.buildMarker).toBe(expectedBuildMarker);
	expect(current.reactIdentity).not.toBeNull();
	// No console assertion here on purpose: an in-page probe cannot see React's
	// invalid-hook-call / #321 logging. The run-wide `page.on("console")` and
	// `page.on("pageerror")` capture in `surface.pw.ts` owns that and fails the
	// run on any unexpected error, so asserting an in-page array would be a
	// vacuous restatement rather than independent evidence.
	expect(current.reactIdentity).toMatchObject({
		identity: true,
		context: true,
		state: true,
		effect: true,
	});
	assertions.push(
		"final-build marker and shared React context/state/effect identity passed",
	);

	const primary = page.locator(PRIMARY);
	const secondary = page.locator(SECONDARY);
	await expect(primary).toHaveRole("region");
	await expect(primary).toHaveAccessibleName("Video editor");
	for (const [mode, tabIndex] of [
		["passive", "-1"],
		["focused", "0"],
		["full", "0"],
	] as const) {
		await page.getByTestId(`mode-${mode}`).click();
		await expect(primary).toHaveAttribute("tabindex", tabIndex);
	}
	assertions.push("named region preserved all frozen tabIndex modes");

	const initialOwned = await ownedSnapshot(page);
	const containment = initialOwned.root.style.contain;
	expect(
		containment === "content" ||
			["layout", "style", "paint"].every((token) =>
				containment.includes(token),
			),
		`expected layout/style/paint containment, got ${containment}`,
	).toBe(true);
	expect(initialOwned.root.style.isolation).toBe("isolate");
	expect(initialOwned.portal.style.background).toBe(
		initialOwned.root.style.background,
	);

	await page.getByTestId("mode-focused").click();
	await expect(primary).toHaveAttribute("tabindex", "0");
	const trigger = page.getByTestId("r2-overlay-trigger-r1-evidence-primary");
	await trigger.focus();
	await expect(trigger).toBeFocused();
	await trigger.press("Enter");
	const dialog = page.getByTestId("r2-owned-dialog-r1-evidence-primary");
	await expect(dialog).toHaveRole("dialog");
	await expect(dialog).toHaveAccessibleName("Surface evidence dialog");
	const primaryPortal = primary.locator("[data-editor-surface-portal]");
	await expect(primaryPortal).toContainText(
		"Representative content owned by this Surface",
	);
	expect(
		await dialog.evaluate(
			(node) =>
				node.parentElement?.closest("[data-editor-surface-portal]") !== null,
		),
	).toBe(true);
	expect(
		await dialog.evaluate((node) => node.parentElement === document.body),
	).toBe(false);
	expect(
		await secondary
			.locator("[data-editor-surface-portal]")
			.locator("[role=dialog]")
			.count(),
	).toBe(0);
	await expect(
		page.getByTestId("r2-dialog-focus-r1-evidence-primary"),
	).toBeFocused();

	const axe = {
		visual: await axeOwned(page, PRIMARY),
		portal: await axeOwned(page, `${PRIMARY} [data-editor-surface-portal]`),
		claim:
			"WCAG2A/WCAG2AA automated evidence is bounded to exercised Surface-owned visual and portal roots; it is not whole-app conformance.",
	};
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	await expect(trigger).toBeFocused();
	await expect(page.getByTestId("host-toaster-sentinel")).not.toHaveAttribute(
		"data-editor-surface",
	);
	assertions.push(
		"owned dialog namespace/focus/Escape/two-Surface isolation and bounded axe scans passed",
	);

	const mountCountBefore = current.calls.filter(
		(entry) => entry.kind === "mount",
	).length;
	const lifecycleBefore = current.calls.filter((entry) =>
		/(?:suspend|resume|unmount|dispose)-call/.test(entry.kind),
	).length;
	const resize = [];
	for (const name of ["compact", "wide", "tall", "wide", "original"] as const) {
		await page.getByTestId(`resize-${name}`).click();
		const expected =
			name === "compact"
				? [420, 260]
				: name === "wide"
					? [900, 320]
					: name === "tall"
						? [520, 620]
						: [720, 420];
		await expect(page.getByTestId("primary-container")).toHaveAttribute(
			"data-size",
			`${expected[0]}x${expected[1]}`,
		);
		const measurement = await page.evaluate(
			({ primary }) => {
				const container = document.querySelector<HTMLElement>(
					'[data-testid="primary-container"]',
				);
				const surface = document.querySelector<HTMLElement>(primary);
				if (!container || !surface) throw new Error("Missing resize nodes.");
				const outer = container.getBoundingClientRect();
				const inner = surface.getBoundingClientRect();
				return {
					name: container.dataset.size,
					outer: { width: outer.width, height: outer.height },
					inner: { width: inner.width, height: inner.height },
				};
			},
			{ primary: PRIMARY },
		);
		expect(measurement.inner.width).toBeLessThanOrEqual(
			measurement.outer.width,
		);
		expect(measurement.inner.height).toBeLessThanOrEqual(
			measurement.outer.height,
		);
		resize.push(measurement);
	}
	const afterResize = await ledger(page);
	expect(
		afterResize.calls.filter((entry) => entry.kind === "mount"),
	).toHaveLength(mountCountBefore);
	expect(
		afterResize.calls.filter((entry) =>
			/(?:suspend|resume|unmount|dispose)-call/.test(entry.kind),
		),
	).toHaveLength(lifecycleBefore);
	assertions.push(
		"compact/wide/tall/same/original resize retained mount and lifecycle identity",
	);

	const dragStart = page.getByTestId("r2-drag-start-r1-evidence-primary");
	const dragResult = page.getByTestId("r2-drag-result-r1-evidence-primary");
	await page.evaluate(() =>
		window.dispatchEvent(new CustomEvent("r2:start-drag:r1-evidence-primary")),
	);
	await expect(dragResult).toHaveAttribute("data-listeners", "2");
	await page.evaluate(() =>
		document.dispatchEvent(
			new MouseEvent("mousemove", {
				clientX: 1500,
				clientY: 900,
				bubbles: true,
			}),
		),
	);
	await page.evaluate(() =>
		document.dispatchEvent(
			new MouseEvent("mouseup", {
				clientX: 1500,
				clientY: 900,
				bubbles: true,
			}),
		),
	);
	await expect(dragResult).toHaveAttribute("data-moves", "1");
	await expect(dragResult).toHaveAttribute("data-finishes", "1");
	await expect(dragResult).toHaveAttribute("data-listeners", "0");
	// Capture HERE, not in the return block. The deterministic render-failure step
	// below replaces the Surface subtree with the error fallback, which destroys
	// these seams — reading them at the end would time out on a detached locator.
	const finishedAfterOutsideDrag = Number(
		await dragResult.getAttribute("data-finishes"),
	);
	const listenersAfterOutsideDrag = Number(
		await dragResult.getAttribute("data-listeners"),
	);
	await expect(
		page.getByTestId("r2-drag-result-r1-evidence-secondary"),
	).toHaveAttribute("data-moves", "0");
	expect(
		(await ledger(page)).calls.filter(
			(entry) => entry.kind === "host-control-activated",
		),
	).toHaveLength(0);

	// The stale-continuation check must read an observable that OUTLIVES the
	// Surface. The rendered `data-finishes` cannot: unmount destroys the
	// component's `useState` counters and remount memoises a fresh coordinator, so
	// reading it after a remount yields 0 whether or not the retired registration
	// fired. `__r2SurfaceDragTallies` is module-scoped and survives, so a stale
	// `finish` is visible here.
	const tallies = async () =>
		await page.evaluate(
			() =>
				(
					window as unknown as {
						__r2SurfaceDragTallies?: Record<
							string,
							{ finishes: number; cancels: number }
						>;
					}
				).__r2SurfaceDragTallies?.["r1-evidence-primary"] ?? {
					finishes: -1,
					cancels: -1,
				},
		);
	await page.evaluate(() =>
		window.dispatchEvent(new CustomEvent("r2:start-drag:r1-evidence-primary")),
	);
	await expect(dragResult).toHaveAttribute("data-listeners", "2");
	const beforeUnmount = await tallies();
	expect(
		beforeUnmount.finishes,
		"the surviving tally must have observed the earlier completed drag",
	).toBe(1);
	// Unmount PROGRAMMATICALLY. A real Playwright click dispatches mousedown ->
	// mouseup -> click, and that mouseup bubbles to document, where the live
	// drag's own listener consumes it and finishes the drag *before* React ever
	// handles the click — so the Surface would unmount with no drag in flight and
	// the scenario under test would never occur. `HTMLElement.click()` dispatches
	// only a click event, leaving the drag genuinely live across the unmount.
	await page.evaluate(() => {
		document
			.querySelector<HTMLElement>('[data-testid="unmount-primary"]')
			?.click();
	});
	await page.evaluate(() =>
		document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
	);
	const afterStaleEvent = await tallies();
	expect(
		afterStaleEvent.finishes,
		"a document mouseup after unmount must not reach the retired registration",
	).toBe(beforeUnmount.finishes);
	expect(
		afterStaleEvent.cancels,
		"unmount must cancel the live registration exactly once",
	).toBe(beforeUnmount.cancels + 1);
	await page.getByTestId("mount-primary").click();
	await expect(
		page.getByTestId("r2-drag-result-r1-evidence-primary"),
	).toHaveAttribute("data-listeners", "0");
	const staleFinish = afterStaleEvent.finishes - beforeUnmount.finishes;
	assertions.push(
		"outside drag finished once, drained listeners, isolated second Surface, and unmount cancelled stale continuation",
	);

	await page.getByTestId("r2-fail-render-r1-evidence-primary").click();
	const alert = primary.getByRole("alert", { name: "Editor unavailable" });
	await expect(alert).toHaveCount(1);
	await expect(alert).toContainText("The editor could not render");
	expect(await alert.textContent()).not.toContain(
		"r2-render-secret-must-not-appear",
	);
	await expect(secondary).toBeVisible();
	await expect(page.getByTestId("outside-after")).toBeVisible();
	const afterFailure = await ledger(page);
	const renderErrors = afterFailure.calls.filter(
		(entry) =>
			entry.surface === "primary" &&
			entry.kind === "error" &&
			(entry.detail as { operation?: string })?.operation ===
				"surface-callback",
	);
	expect(renderErrors).toHaveLength(1);
	expect(
		afterFailure.calls.filter((entry) => entry.kind === "dispose-call"),
	).toHaveLength(0);
	assertions.push(
		"one bounded named alert contained deterministic failure without secret/disposal/cross-Surface loss",
	);

	return {
		assertions,
		axe,
		resize,
		// Every field here is read back from the run, not asserted as a literal:
		// `finished`/`listeners` from the rendered attributes captured at assertion
		// time, `staleFinish` from the surviving module-scoped tally across the
		// unmount.
		drag: {
			finished: finishedAfterOutsideDrag,
			listeners: listenersAfterOutsideDrag,
			staleFinish,
		},
	};
}
