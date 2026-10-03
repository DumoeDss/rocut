import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";

export async function probeResponsiveMotion(parent, frame, work, evidence) {
	const original = parent.viewportSize();
	try {
		for (const width of [900, 760]) {
			await parent.setViewportSize({ width, height: 640 });
			await frame.locator('.panel').filter({ has: frame.locator('[aria-label="Media"]') }).locator('[aria-label="Motion text"]').click();
			await frame.locator('[aria-label="Timeline"]').getByText("Clean caption", { exact: true }).click();
			const add = frame.locator('[data-testid="motion-text-add"]');
			await expect(add).toBeVisible();
			const action = await add.boundingBox();
			assert(action && action.x >= 0 && action.x + action.width <= width && action.y + action.height <= 640, "Add action must remain inside the viewport");
			await frame.getByRole("button", { name: "Edit font and colors", exact: true }).click();
			const field = frame.getByText("Default font", { exact: true }).locator("..").locator("..");
			await field.getByRole("combobox").click();
			const menu = frame.getByRole("listbox");
			await expect(menu).toBeVisible();
			const rect = await menu.boundingBox();
			assert(rect && rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= width + 1 && rect.y + rect.height <= 641, "Font menu must be contained by the editor viewport");
			await parent.screenshot({ path: join(work, `narrow-font-${width}.png`) });
			await frame.evaluate(() => {
				globalThis.__motionEscapeEvents = [];
				for (const capture of [true, false]) document.addEventListener("keydown", event => {
					if (event.key === "Escape") globalThis.__motionEscapeEvents.push({ capture, prevented: event.defaultPrevented, target: event.target?.tagName, role: event.target?.getAttribute?.("role") });
				}, { capture, once: true });
			});
			await parent.keyboard.press("Escape");
			await expect(menu).toHaveCount(0);
			evidence.checks.push({ name: "narrow font Escape state", width, ...await frame.evaluate(() => ({ events: globalThis.__motionEscapeEvents, active: document.activeElement?.tagName, body: document.body.innerText.slice(-1800) })) });
			await parent.screenshot({ path: join(work, `narrow-after-escape-${width}.png`) });
			const closeDefaults = frame.getByRole("button", { name: "Close defaults editor", exact: true });
			await expect(closeDefaults, "Escape must close only the font menu, preserving the selected clip and editor").toBeVisible();
			await expect(field.getByRole("combobox"), "Closing the menu must return focus to its trigger").toBeFocused();
			const form = field.locator("..");
			const overflow = await form.evaluate(element => ({ width: element.clientWidth, contentWidth: element.scrollWidth }));
			assert(overflow.contentWidth <= overflow.width + 1, `Defaults form must not overflow horizontally: ${JSON.stringify(overflow)}`);
			await form.getByRole("button", { name: "Customize", exact: true }).click();
			const colorField = form.locator("label").filter({ hasText: /^Text$/ }).locator("..");
			await colorField.getByRole("textbox").fill("00FF00");
			await colorField.getByRole("textbox").press("Tab");
			await expect(colorField.getByRole("textbox")).toHaveValue("00FF00");
			const colorOverflow = await form.evaluate(element => ({ width: element.clientWidth, contentWidth: element.scrollWidth }));
			assert(colorOverflow.contentWidth <= colorOverflow.width + 1, `Color controls must not overflow horizontally: ${JSON.stringify(colorOverflow)}`);
			await form.getByRole("button", { name: "Cancel", exact: true }).scrollIntoViewIfNeeded();
			await expect(form.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
			await parent.screenshot({ path: join(work, `narrow-palette-${width}.png`) });
			await closeDefaults.click();
			await frame.locator('[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]').last().scrollIntoViewIfNeeded();
			await expect(frame.locator('[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]').last()).toBeInViewport();
			await parent.screenshot({ path: join(work, `narrow-cues-${width}.png`) });
			evidence.checks.push({ name: "narrow motion actions, font menu and final cue reachable", width, height: 640, pass: true });
		}
	} finally {
		if (original) await parent.setViewportSize(original);
	}
}
