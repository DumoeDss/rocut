import assert from "node:assert/strict";
import { blazeEditorRedact } from "./blaze-editor-lifecycle.mjs";

export async function observeBlazeEditorExportPage(page, editorUrl, evidence) {
	await page.route(
		(url) => /^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1",
		async (route) => {
			evidence.externalRequests.push(new URL(route.request().url()).origin);
			await route.abort();
		},
	);
	page.on("pageerror", (error) =>
		evidence.errors.push(blazeEditorRedact(error.message)),
	);
	page.on("console", (message) => {
		if (message.type() === "error")
			evidence.consoleErrors.push(blazeEditorRedact(message.text()));
		if (message.type() === "warning")
			evidence.warnings.push(blazeEditorRedact(message.text()));
	});
	page.on("response", (response) => {
		if (response.status() >= 400)
			evidence.httpFailures.push({
				status: response.status(),
				path:
					"/" +
					new URL(response.url()).pathname.slice(
						new URL(editorUrl).pathname.length,
					),
			});
	});
}
export function assertBlazeEditorExportBrowserErrors(evidence) {
	assert.deepEqual(evidence.errors, []);
	assert.deepEqual(evidence.externalRequests, []);
	assert.deepEqual(
		evidence.httpFailures.filter(
			(failure) =>
				!(
					failure.status === 404 &&
					failure.path === "/api/library/graph-editor-presets/user-presets"
				),
		),
		[],
	);
	assert(evidence.consoleErrors.length <= evidence.httpFailures.length);
	assert(
		evidence.consoleErrors.every(
			(message) =>
				message ===
				"Failed to load resource: the server responded with a status of 404 (Not Found)",
		),
	);
}
