import assert from "node:assert/strict";
import test from "node:test";
import { flameWrapEditorRequest } from "./flame-wrap-editor-request.mjs";
const base = "http://127.0.0.1:12345/private/";
const reply = (status, payload = { id: "job-1" }) => ({
	status,
	json: async () => payload,
});
test("strict endpoint statuses: export/task POST202; registry/job GET and apply POST200", async () => {
	for (const [route, body, expected] of [
		["export", {}, 202],
		["editor-tasks", {}, 202],
		["export", undefined, 200],
		["export/job-1", undefined, 200],
		["editor-tasks/task-1", undefined, 200],
		["apply", {}, 200],
	]) {
		const request = flameWrapEditorRequest(base, {
			fetch: async () => reply(expected),
		});
		assert.deepEqual(await request(route, body), { id: "job-1" });
		for (const status of [200, 201, 202, 204, 400, 500].filter(
			(status) => status !== expected,
		)) {
			await assert.rejects(
				flameWrapEditorRequest(base, { fetch: async () => reply(status) })(
					route,
					body,
				),
				/unexpected Host HTTP status/,
			);
		}
	}
});
test("request URL encoding, JSON header/body, GET no POST state/timestamp carry, timeout15000", async (t) => {
	const calls = [],
		signal = new AbortController().signal;
	t.mock.method(AbortSignal, "timeout", (milliseconds) => {
		assert.equal(milliseconds, 15000);
		return signal;
	});
	const request = flameWrapEditorRequest(base, {
		fetch: async (url, options) => {
			calls.push({ url: url.href, options });
			return reply(200);
		},
	});
	await request("apply", { label: "火焰", ticks: 20000 });
	await request("export/作业 1");
	assert.equal(calls[0].url, `${base}api/apply`);
	assert.equal(calls[0].options.method, "POST");
	assert.deepEqual(calls[0].options.headers, {
		"content-type": "application/json",
	});
	assert.deepEqual(JSON.parse(calls[0].options.body), {
		label: "火焰",
		ticks: 20000,
	});
	assert.equal(calls[1].url, `${base}api/export/%E4%BD%9C%E4%B8%9A%201`);
	assert.deepEqual(Object.keys(calls[1].options), ["signal"]);
	assert.equal(calls[1].options.signal, signal);
});
test("collections admitted; malformed success payload and empty export job id rejected", async () => {
	assert.deepEqual(
		await flameWrapEditorRequest(base, { fetch: async () => reply(200, []) })(
			"clips",
		),
		[],
	);
	for (const value of [null, "text", 1, true])
		await assert.rejects(
			flameWrapEditorRequest(base, { fetch: async () => reply(200, value) })(
				"context",
			),
			/payload must be/,
		);
	for (const id of [undefined, "", 0, null])
		await assert.rejects(
			flameWrapEditorRequest(base, { fetch: async () => reply(202, { id }) })(
				"export",
				{},
			),
			/nonempty job id/,
		);
});
test("network and malformed JSON failures propagate without relaxing contract", async () => {
	const error = new Error("mock network failure");
	await assert.rejects(
		flameWrapEditorRequest(base, {
			fetch: async () => {
				throw error;
			},
		})("export", {}),
		(value) => value === error,
	);
	await assert.rejects(
		flameWrapEditorRequest(base, {
			fetch: async () => ({
				status: 202,
				json: async () => {
					throw new SyntaxError("mock JSON failure");
				},
			}),
		})("export", {}),
		/mock JSON failure/,
	);
});
