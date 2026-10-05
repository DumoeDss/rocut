import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";

export async function probeUiExportAccessibility({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	onPhase("export options keyboard and narrow-window scrolling");
	const viewport = hostPage.viewportSize();
	const trigger = page.getByTestId("editor-menu-trigger");
	const dialog = page.getByRole("dialog", {
		name: "Export project",
		exact: true,
	});
	try {
		await hostPage.setViewportSize({ width: 1000, height: 650 });
		await trigger.click();
		await page
			.getByRole("menuitem", { name: "Export project", exact: true })
			.click();
		await expect(dialog).toBeVisible();
		for (const name of ["Format", "Quality", "Range", "Audio"])
			await expect(
				dialog.getByRole("button", { name, exact: true }),
			).toHaveAttribute("aria-expanded", "false");
		const focusStates = [];
		for (let index = 0; index < 15; index++) {
			await hostPage.keyboard.press("Tab");
			const state = await page.evaluate(() => {
				const element = document.activeElement;
				return {
					inDialog: !!element?.closest('[role="dialog"]'),
					inHidden: !!element?.closest('[inert], [aria-hidden="true"]'),
					id: element?.id,
					role: element?.getAttribute("role"),
					text: element?.textContent?.slice(0, 60),
				};
			});
			assert(
				state.inDialog && !state.inHidden,
				"Tab must stay in visible dialog controls, never a collapsed option",
			);
			assert(
				!["radio", "checkbox"].includes(state.role),
				"collapsed radio/checkbox controls must be skipped",
			);
			focusStates.push(state);
		}
		const format = dialog.getByRole("button", { name: "Format", exact: true });
		await format.focus();
		await hostPage.keyboard.press("Enter");
		const webm = dialog.getByRole("radio", {
			name: "WebM (VP9) - Smaller file size",
			exact: true,
		});
		await webm.check();
		await format.click();
		await expect(format).toHaveAttribute("aria-expanded", "false");
		await format.click();
		await expect(webm).toBeChecked();
		await dialog.getByRole("button", { name: "Quality", exact: true }).click();
		await dialog.getByRole("button", { name: "Audio", exact: true }).click();
		const audio = dialog.getByRole("checkbox", {
			name: "Include audio in export",
			exact: true,
		});
		await audio.uncheck();
		await dialog.getByRole("button", { name: "Audio", exact: true }).click();
		await dialog.getByRole("button", { name: "Audio", exact: true }).click();
		await expect(audio).not.toBeChecked();
		await dialog.getByRole("button", { name: "Range", exact: true }).click();
		// Scroll with actual wheel input; DOM writes/scrollIntoView are not wheel evidence.
		await format.click();
		await format.click();
		await expect
			.poll(() => dialog.evaluate((el) => el.scrollHeight - el.clientHeight))
			.toBeGreaterThan(0);
		const box = await dialog.boundingBox();
		assert(box);
		const scrollStart = await dialog.evaluate((el) => el.scrollTop);
		evidence.exportAccessibilityGeometry = {
			host: await hostPage.evaluate(() => ({
				width: innerWidth,
				height: innerHeight,
			})),
			frame: await page.evaluate(() => ({
				width: innerWidth,
				height: innerHeight,
			})),
			dialog: await dialog.evaluate((el) => ({
				height: el.clientHeight,
				scrollHeight: el.scrollHeight,
				scrollTop: el.scrollTop,
				overflow: getComputedStyle(el).overflowY,
			})),
			box,
		};
		await hostPage.screenshot({
			path: join(work, "export-options-before-wheel.png"),
		});
		await hostPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await hostPage.mouse.wheel(0, 800);
		await expect
			.poll(() => dialog.evaluate((el) => el.scrollTop))
			.toBeGreaterThan(scrollStart);
		await expect(
			dialog.getByRole("button", { name: "Export", exact: true }),
		).toBeInViewport();
		// Also wait for transient upload notices to stop covering the button.
		await dialog
			.getByRole("button", { name: "Export", exact: true })
			.click({ trial: true });
		await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
			timeout: 15000,
		});
		await hostPage.screenshot({
			path: join(work, "export-options-narrow.png"),
		});
		await hostPage.keyboard.press("Escape");
		await expect(dialog).toHaveCount(0);
		await expect(trigger).toBeFocused();
		evidence.checks.push({
			name: "collapsed export controls skip keyboard focus; expanded values persist and actual wheel reaches Export in a narrow window",
			pass: true,
			focusStates,
		});
	} finally {
		if (await dialog.count()) await hostPage.keyboard.press("Escape");
		if (viewport) await hostPage.setViewportSize(viewport);
	}
}
