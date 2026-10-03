import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";

// Electron/CDP can miss the frame's navigation event around beforeunload.
// A per-document marker proves the old JS context was actually replaced.
export async function reloadEditorFrame(frame) {
	// View-state autosaves are debounced even after the last content transaction
	// is durable. Wait for a quiet persisted record before asking Electron to
	// navigate; its native beforeunload policy can cancel an in-flight save.
	let previous = null;
	let changedAt = Date.now();
	await expect
		.poll(
			async () => {
				const record = await frame.evaluate(async () => {
					const response = await fetch(new URL("api/record", location.href));
					if (!response.ok)
						throw new Error("Cannot check persisted state before reload");
					return JSON.stringify((await response.json()).record);
				});
				if (record !== previous) {
					previous = record;
					changedAt = Date.now();
				}
				return Date.now() - changedAt >= 1500;
			},
			{
				timeout: 15000,
				message: "Persisted editor state must settle before reload",
			},
		)
		.toBe(true);
	const marker = "__rocut_reload_" + randomUUID().replaceAll("-", "");
	await frame.evaluate((key) => {
		globalThis[key] = true;
	}, marker);
	await frame.evaluate(() => location.reload());
	await expect
		.poll(
			async () => {
				try {
					return await frame.evaluate(
						(key) => globalThis[key] !== true,
						marker,
					);
				} catch {
					return false;
				}
			},
			{ timeout: 30000, message: "Editor reload must replace its document" },
		)
		.toBe(true);
	await expect(frame.locator('[aria-label="Media"]')).toBeVisible({
		timeout: 30000,
	});
}
