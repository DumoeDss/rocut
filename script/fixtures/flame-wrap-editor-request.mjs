import assert from "node:assert/strict";

export function flameWrapEditorRequest(
	editorUrl,
	{ fetch: fetchImpl = globalThis.fetch } = {},
) {
	return async (route, body) => {
		const post = body !== undefined;
		const response = await fetchImpl(new URL(`api/${route}`, editorUrl), {
			signal: AbortSignal.timeout(15000),
			...(post
				? {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}
				: {}),
		});
		const value = await response.json();
		const expectedStatus =
			post && ["export", "editor-tasks"].includes(route) ? 202 : 200;
		assert.equal(
			response.status,
			expectedStatus,
			`${route}: unexpected Host HTTP status`,
		);
		// clips/tracks are arrays; other Host endpoints return record objects.
		assert(
			value !== null && typeof value === "object",
			`${route}: Host payload must be an object or collection`,
		);
		if (post && route === "export")
			assert(
				typeof value.id === "string" && value.id.trim().length > 0,
				"Export submission must return a nonempty job id",
			);
		return value;
	};
}
