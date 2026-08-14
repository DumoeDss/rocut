import type { Page } from "@playwright/test";
import { HOST } from "./host-profile";

/**
 * UI driving primitives for the parity scenario.
 *
 * Selector policy: **no `data-testid` was added to the editor source.** The
 * editor is inherited upstream code and this Slice compares two hosts running
 * it, so instrumenting it for the test would be a patch to the thing under
 * comparison. Everything below therefore keys off attributes the editor already
 * ships — ARIA labels on tracks, resize handles and the ruler, and the `title`
 * the timecode display already carries.
 *
 * Two gotchas are encoded here rather than left to be rediscovered:
 * clip drag/trim is `mousedown` + document-level `mousemove` (so it needs real
 * stepped mouse movement, not `dragTo`), and keyboard shortcuts must be sent
 * with focus inside `[data-editor-surface]`. R1 deliberately removed document
 * capture; blurring to body would now test the Host rather than the Surface.
 */

export const MAIN_TRACK = 'button[aria-label="Select Main Track track"]';
export const RULER = '[aria-label="Timeline ruler"]';
export const TIMECODE = 'button[title="Click to edit time"]';
export const SNAP_INDICATOR = 'div[class*="bg-primary/40"]';
const TRACK_BUTTON = 'button[aria-label^="Select "][aria-label$=" track"]';
const ELEMENT_WRAPPER =
	'div[class~="absolute"][class~="top-0"][class~="select-none"]';

export interface ElementBox {
	name: string;
	trackLabel: string;
	trackIndex: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The editor is on screen once its own main track exists. Host-neutral. */
export async function waitForEditor(page: Page): Promise<void> {
	await page.locator(MAIN_TRACK).first().waitFor({ timeout: 300_000 });
	await page.locator(TIMECODE).first().waitFor({ timeout: 300_000 });
}

/**
 * The first-run onboarding dialog is editor source, so it appears in **both**
 * hosts on a fresh browser profile and blocks every click behind its modal
 * overlay. Dismissing it is part of driving the editor, not a host workaround.
 * Returns whether one was actually present.
 */
export async function dismissOnboarding(page: Page): Promise<string | null> {
	const dialog = page.locator('[role="dialog"]').first();
	const present = await dialog.isVisible().catch(() => false);
	if (!present) return null;
	// Report *which* dialog it was rather than dismissing blind: the same surface
	// is where a storage migration would announce itself, and a migration is a
	// finding, not something to Escape past silently.
	const title = ((await dialog.textContent()) ?? "").trim().slice(0, 120);
	await page.keyboard.press("Escape");
	await dialog.waitFor({ state: "hidden", timeout: 30_000 });
	return title;
}

/**
 * Import through the panel's own upload affordance.
 *
 * `setInputFiles` on the hidden `<input>` directly does not work: `multiple` is
 * not an attribute in the markup, it is set imperatively by `openFilePicker()`
 * just before the native dialog opens. Going through the file chooser exercises
 * that path, which is also the one a user takes.
 */
export async function importFixtures(
	page: Page,
	files: string[],
): Promise<void> {
	if (HOST === "electron") {
		// Electron windows do not surface Playwright's `filechooser` event, so
		// the real-chooser dance below cannot complete there. The editor's own
		// always-mounted hidden `<input type="file">` (assets panel) is the
		// same import path its change handler serves — setting files on it
		// runs the editor's own import code. `openFilePicker` sets `multiple`
		// on the input immediately before the native dialog would open (the
		// dialog the interception stands in for on the browser hosts), so that
		// one statement is reproduced here; then one `setInputFiles` produces
		// the same single change event with all files that the intercepted
		// chooser produces there. The browser hosts keep the genuine chooser
		// flow, unchanged.
		const input = page.locator('input[type="file"]').first();
		await input.evaluate((el) => {
			(el as HTMLInputElement).multiple = true;
		});
		await input.setInputFiles(files);
		return;
	}
	const [chooser] = await Promise.all([
		page.waitForEvent("filechooser"),
		page
			.locator(
				'button:has-text("Drag and drop videos, photos, and audio files here")',
			)
			.first()
			.click(),
	]);
	await chooser.setFiles(files);
}

/** The assets-panel card for an imported asset, located by the label `title`. */
export function assetCard(page: Page, name: string) {
	return page
		.locator("div.group")
		.filter({ has: page.locator(`[title="${name}"]`) })
		.first();
}

/** Click a card's "add to timeline" plus button (it reveals on hover). */
export async function addToTimeline(page: Page, name: string): Promise<void> {
	const card = assetCard(page, name);
	await card.scrollIntoViewIfNeeded();
	await card.hover();
	await card.locator("button").first().click();
}

export async function timelineElements(page: Page): Promise<ElementBox[]> {
	return page.evaluate(
		({ trackButton, wrapperSelector }) => {
			const boxes: ElementBox[] = [];
			const buttons = [...document.querySelectorAll(trackButton)];
			buttons.forEach((button, trackIndex) => {
				const root = button.parentElement;
				if (!root) return;
				for (const wrapper of root.querySelectorAll(wrapperSelector)) {
					const rect = wrapper.getBoundingClientRect();
					if (rect.width === 0 && rect.height === 0) continue;
					boxes.push({
						name: (wrapper.textContent ?? "").trim(),
						trackLabel: button.getAttribute("aria-label") ?? "",
						trackIndex,
						x: rect.x,
						y: rect.y,
						width: rect.width,
						height: rect.height,
					});
				}
			});
			return boxes;
		},
		{ trackButton: TRACK_BUTTON, wrapperSelector: ELEMENT_WRAPPER },
	) as Promise<ElementBox[]>;
}

export async function findElement(
	page: Page,
	nameFragment: string,
): Promise<ElementBox> {
	const boxes = await timelineElements(page);
	const match = boxes.find((box) => box.name.includes(nameFragment));
	if (!match) {
		throw new Error(
			`no timeline clip whose label contains "${nameFragment}" (found: ${boxes
				.map((box) => `${box.trackLabel}:${box.name}`)
				.join(" | ")})`,
		);
	}
	return match;
}

export async function clickElement(
	page: Page,
	nameFragment: string,
): Promise<ElementBox> {
	const box = await findElement(page, nameFragment);
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	return box;
}

export interface DragOptions {
	/** Runs while the button is still down — the only moment snap feedback exists. */
	whileDragging?: () => Promise<void>;
	steps?: number;
	/** Grab offset from the clip's left edge; defaults to the middle. */
	grabOffsetPx?: number;
}

/** Move a clip horizontally with real stepped mouse events. */
export async function dragElementBy(
	page: Page,
	nameFragment: string,
	dx: number,
	options: DragOptions = {},
): Promise<{ before: ElementBox; after: ElementBox }> {
	const before = await findElement(page, nameFragment);
	const steps = options.steps ?? 16;
	const startX =
		before.x + (options.grabOffsetPx ?? Math.min(before.width / 2, 60));
	const startY = before.y + before.height / 2;

	await page.mouse.move(startX, startY);
	await page.mouse.down();
	for (let step = 1; step <= steps; step += 1) {
		await page.mouse.move(startX + (dx * step) / steps, startY);
		await page.waitForTimeout(20);
	}
	await options.whileDragging?.();
	await page.mouse.up();
	await page.waitForTimeout(400);

	return { before, after: await findElement(page, nameFragment) };
}

/**
 * Trim by dragging a resize handle. The handles only exist while the clip is
 * selected, which is why the clip is clicked first.
 */
export async function trimElement(
	page: Page,
	nameFragment: string,
	side: "left" | "right",
	dx: number,
): Promise<{ before: ElementBox; after: ElementBox }> {
	const before = await clickElement(page, nameFragment);
	const handle = page.locator(
		`button[aria-label="${side === "left" ? "Left" : "Right"} resize handle"]`,
	);
	await handle.first().waitFor({ timeout: 30_000 });
	const handleBox = await handle.first().boundingBox();
	if (!handleBox) throw new Error(`${side} resize handle has no box`);

	const startX = handleBox.x + handleBox.width / 2;
	const startY = handleBox.y + handleBox.height / 2;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	for (let step = 1; step <= 12; step += 1) {
		await page.mouse.move(startX + (dx * step) / 12, startY);
		await page.waitForTimeout(20);
	}
	await page.mouse.up();
	await page.waitForTimeout(400);

	return { before, after: await findElement(page, nameFragment) };
}

/**
 * The part of the ruler a mouse can actually reach.
 *
 * The ruler's box is the full timeline content width, which at any useful zoom
 * is wider than the window. Dispatching a click at a coordinate outside the
 * viewport hits no element at all and silently does nothing — which reads as
 * "seeking is broken" rather than "the driver aimed off-screen".
 */
export async function rulerVisibleBox(
	page: Page,
): Promise<{ x: number; width: number; y: number; height: number }> {
	const box = await page.locator(RULER).first().boundingBox();
	if (!box) throw new Error("timeline ruler has no box");
	const viewport = page.viewportSize();
	const right = Math.min(box.x + box.width, (viewport?.width ?? 1600) - 8);
	return { x: box.x, width: right - box.x, y: box.y, height: box.height };
}

/** Seek by clicking the ruler at a viewport x. Returns the timecode after. */
export async function scrubToX(page: Page, x: number): Promise<string> {
	const box = await rulerVisibleBox(page);
	const clampedX = Math.min(Math.max(x, box.x + 1), box.x + box.width - 1);
	await page.mouse.move(clampedX, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(clampedX, box.y + box.height / 2);
	await page.mouse.up();
	await page.waitForTimeout(300);
	return readTimecode(page);
}

export async function readTimecode(page: Page): Promise<string> {
	return (await page.locator(TIMECODE).first().textContent())?.trim() ?? "";
}

/** Focus the Surface root before every editor shortcut. */
export async function pressShortcut(page: Page, key: string): Promise<void> {
	const surface = page.locator("[data-editor-surface]").first();
	await surface.focus();
	const ownsFocus = await surface.evaluate(
		(root) =>
			document.activeElement === root ||
			(root instanceof HTMLElement && root.contains(document.activeElement)),
	);
	if (!ownsFocus)
		throw new Error("Editor Surface did not accept shortcut focus");
	await page.keyboard.press(key);
	await page.waitForTimeout(300);
}

/** Autosave is debounced at 800 ms; this waits past it before reading storage. */
export async function settleAutosave(page: Page): Promise<void> {
	await page.waitForTimeout(2_000);
}
