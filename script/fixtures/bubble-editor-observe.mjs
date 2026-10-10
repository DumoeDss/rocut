import { observeBlazeEditorExportPage } from "./blaze-editor-export-browser.mjs";
import assert from "node:assert/strict";

export function assertBubbleEditorCommitCycle(cycle, attempt) {
	assert.equal(cycle.attempt, attempt, "Commit observation belongs to another attempt");
	assert.equal(cycle.initialBusy, "false");
	assert.equal(cycle.initialDisabled, false);
	assert.equal(cycle.connected, true, "Observed effect fieldset was replaced");
	assert.deepEqual(cycle.busyValues, ["false", "true", "false"],
		"A fresh completed DOM save cycle is required; an old alert is insufficient");
	assert.equal(cycle.busy, "false");
	assert.equal(cycle.disabled, false);
	return true;
}

export async function beginBubbleEditorCommitObservation(page, label, attempt) {
	await page.getByRole("textbox", { name: label, exact: true }).filter({ visible: true })
		.evaluate((input, attempt) => {
			if (globalThis.__bubbleCommitObservation) throw Error("Commit observer already armed");
			const fieldset = input.closest("fieldset[aria-busy]");
			if (!fieldset || fieldset.getAttribute("aria-busy") !== "false" || fieldset.disabled)
				throw Error("Effect fieldset is not idle before attempt");
			const state = { attempt, fieldset, initialBusy: fieldset.getAttribute("aria-busy"),
				initialDisabled: fieldset.disabled, busyValues: ["false"] };
			state.collect = (records) => {
				const busy = records.filter((record) => record.attributeName === "aria-busy");
				for (let i = 0; i < busy.length; i++) {
					// Reconstruct intermediate DOM values even if both mutations were
					// delivered together. No mutation means no fabricated busy cycle.
					for (const value of [busy[i].oldValue,
						busy[i + 1]?.oldValue ?? fieldset.getAttribute("aria-busy")])
						if (state.busyValues.at(-1) !== value) state.busyValues.push(value);
				}
			};
			state.observer = new MutationObserver(state.collect);
			state.observer.observe(fieldset, { attributes: true, attributeOldValue: true,
				attributeFilter: ["aria-busy"] });
			globalThis.__bubbleCommitObservation = state;
		}, attempt);
}

export async function finishBubbleEditorCommitObservation(page, attempt) {
	return page.evaluate((attempt) => {
		const state = globalThis.__bubbleCommitObservation;
		if (!state || state.attempt !== attempt) throw Error("Missing current commit observation");
		state.collect(state.observer.takeRecords());
		state.observer.disconnect();
		delete globalThis.__bubbleCommitObservation;
		return { attempt, initialBusy: state.initialBusy, initialDisabled: state.initialDisabled,
			busyValues: state.busyValues, connected: state.fieldset.isConnected,
			busy: state.fieldset.getAttribute("aria-busy"), disabled: state.fieldset.disabled };
	}, attempt);
}

export async function isBubbleEditorCommitObservationComplete(page, attempt) {
	return page.evaluate((attempt) => {
		const state = globalThis.__bubbleCommitObservation;
		if (!state || state.attempt !== attempt) throw Error("Missing current commit observation");
		state.collect(state.observer.takeRecords());
		return state.fieldset.isConnected && !state.fieldset.disabled &&
			state.fieldset.getAttribute("aria-busy") === "false" &&
			JSON.stringify(state.busyValues) === '["false","true","false"]';
	}, attempt);
}
export function isBubbleEditorPointPreviewError(message) {
	return /^Failed to render preview frame: Error: Invalid Bubble trajectory: InvalidPointTime(?:\n\s+at [^\n]+)*$/.test(message);
}
export async function observeBubbleEditorPage(page, editorUrl, evidence) {
	await observeBlazeEditorExportPage(page, editorUrl, evidence);
	page.on("requestfailed", (request) => evidence.requestFailures.push({
		path: new URL(request.url()).pathname,
		error: request.failure()?.errorText ?? "Unknown failed browser request",
	}));
	page.on("request", (request) => {
		if (new URL(request.url()).pathname.endsWith("/api/apply") && request.method() === "POST")
			evidence.applyRequests.push({ attempt: evidence.rejectionWindow?.id ?? null });
	});
	page.on("response", async (response) => {
		if (response.status() !== 409 || !new URL(response.url()).pathname.endsWith("/api/apply")) return;
		const window = evidence.rejectionWindow;
		try { evidence.applyRejections.push({ attempt: window?.id ?? null,
			body: await response.json(), wire: response.request().postData() ?? "" }); }
		catch (error) { evidence.errors.push(`Bubble rejection response unreadable: ${String(error)}`); }
	});
	page.on("console", (message) => {
		if (message.type() !== "error" || !isBubbleEditorPointPreviewError(message.text())) return;
		const window = evidence.rejectionWindow;
		if (window) evidence.localPointErrors.push({ attempt: window.id,
			consoleIndex: evidence.consoleErrors.length - 1 });
	});
}
