import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { createUiMaskFixture } from "./probe-mask-fixture.mjs";
import { verifyMaskPreview, verifyMaskExport } from "./probe-mask-media.mjs";
import { downloadUiExport } from "./probe-ui-export-fixture.mjs";
import { probeMaskHandleEdges } from "./probe-mask-handle-edges.mjs";

export async function probeFreeformMask({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	onPhase("freeform mask actual pointer drawing");
	await hostPage.setViewportSize({ width: 1920, height: 1080 });
	await createUiMaskFixture({ page, work });
	const readClip = () =>
		page.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			return record.data.scenes[0].tracks.main.elements[0];
		});
	await page
		.getByRole("button", { name: "Add mask", exact: true })
		.first()
		.click();
	await page.getByRole("menuitem", { name: "Pen tool", exact: true }).click();
	await expect
		.poll(async () => (await readClip()).masks?.[0]?.type)
		.toBe("freeform");
	const pointer = async (x, y) => {
		const box = await page.locator("canvas").first().boundingBox();
		assert(box);
		return { x: box.x + box.width * x, y: box.y + box.height * y };
	};
	const click = async (x, y) => {
		const p = await pointer(x, y);
		await hostPage.mouse.click(p.x, p.y);
	};
	for (const [index, [x, y]] of [
		[0.25, 0.25],
		[0.75, 0.25],
		[0.75, 0.75],
		[0.25, 0.75],
	].entries()) {
		await click(x, y);
		await expect
			.poll(async () => (await readClip()).masks[0].params.path.length)
			.toBe(index + 1);
	}
	await click(0.25, 0.25);
	await expect
		.poll(async () => (await readClip()).masks[0].params.closed)
		.toBe(true);
	const closed = await readClip();
	const pointIds = closed.masks[0].params.path.map((p) => p.id);
	const preview = async () => {
		await page.getByTestId("timeline-clip").click();
		await hostPage.keyboard.press("Escape");
		try {
			return await verifyMaskPreview(page, 0.25);
		} finally {
			await page.getByTestId("timeline-clip").click();
			await page.getByLabel("Masks", { exact: true }).click();
		}
	};
	const initialArea = await preview();
	evidence.checks.push({
		name: "actual pointer creates and closes four-point mask with expected quarter-frame reveal",
		pass: true,
		initialArea,
		pointIds,
	});
	onPhase("freeform segment insertion and deletion");
	await click(0.5, 0.25);
	await expect
		.poll(async () => (await readClip()).masks[0].params.path.length)
		.toBe(5);
	const inserted = await readClip();
	const newPoints = inserted.masks[0].params.path.filter(
		(p) => !pointIds.includes(p.id),
	);
	assert.equal(newPoints.length, 1);
	assert.deepEqual(
		inserted.masks[0].params.path
			.filter((p) => pointIds.includes(p.id))
			.map((p) => p.id),
		pointIds,
	);
	await preview();
	await click(0.5, 0.25);
	await hostPage.keyboard.press("Delete");
	await expect
		.poll(async () => (await readClip()).masks[0].params.path.length)
		.toBe(4);
	const deleted = await readClip();
	assert.deepEqual(
		deleted.masks[0].params.path.map((p) => p.id),
		pointIds,
	);
	await hostPage.keyboard.press("Control+z");
	await expect.poll(readClip).toEqual(inserted);
	await hostPage.keyboard.press("Control+Shift+z");
	await expect.poll(readClip).toEqual(deleted);
	await preview();
	evidence.checks.push({
		name: "actual segment click inserts one stable point; Delete and exact undo redo preserve the clip and mask",
		pass: true,
	});
	onPhase("freeform anchor drag and history");
	const from = await pointer(0.25, 0.25),
		to = await pointer(0.18, 0.18);
	await hostPage.mouse.move(from.x, from.y);
	await hostPage.mouse.down();
	await hostPage.mouse.move(to.x, to.y, { steps: 8 });
	await hostPage.mouse.up();
	await expect
		.poll(async () => JSON.stringify((await readClip()).masks[0].params))
		.not.toBe(JSON.stringify(deleted.masks[0].params));
	const dragged = await readClip();
	assert.deepEqual(
		dragged.masks[0].params.path.map((p) => p.id),
		pointIds,
	);
	await hostPage.keyboard.press("Control+z");
	await expect.poll(readClip).toEqual(deleted);
	await hostPage.keyboard.press("Control+Shift+z");
	await expect.poll(readClip).toEqual(dragged);
	await hostPage.keyboard.press("Control+z");
	await expect.poll(readClip).toEqual(deleted);
	evidence.checks.push({
		name: "anchor pointer drag commits one durable edit with stable IDs and exact history",
		pass: true,
	});
	onPhase("freeform closed path reload and export");
	await page.reload();
	await expect.poll(readClip).toEqual(deleted);
	await preview();
	await hostPage.screenshot({ path: join(work, "freeform-restored.png") });
	const cdp = await hostPage.context().browser().newBrowserCDPSession();
	try {
		await cdp.send("Browser.setDownloadBehavior", {
			behavior: "allowAndName",
			downloadPath: work,
			eventsEnabled: true,
		});
		await page.getByTestId("editor-menu-trigger").click();
		await page
			.getByRole("menuitem", { name: "Export project", exact: true })
			.click();
		const output = await downloadUiExport(
			cdp,
			page.getByRole("dialog", { name: "Export project", exact: true }),
			work,
		);
		evidence.checks.push({
			name: "freeform mask survives reload and actual UI export retains its revealed geometry",
			pass: true,
			...verifyMaskExport(output, 0.25),
		});
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
	await probeMaskHandleEdges({
		page,
		hostPage,
		evidence,
		onPhase,
		readClip,
		pointer,
		click,
		closed: deleted,
	});
}
