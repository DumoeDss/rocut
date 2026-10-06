import { expect, test } from "bun:test";
import { parseSoundSearchParameters } from "./search-params";

test("commercial filter decodes explicit false and defaults to true", () => {
	for (const [query, expected] of [
		["", true],
		["commercial_only=true", true],
		["commercial_only=false", false],
	] as const) {
		const parsed = parseSoundSearchParameters(new URLSearchParams(query));
		expect(parsed.success).toBe(true);
		if (!parsed.success) throw new Error("Expected valid query");
		expect(parsed.data.commercial_only).toBe(expected);
	}
});

test("invalid commercial filter cannot silently broaden the result", () => {
	for (const value of ["", "0", "1", "yes", "False"]) {
		expect(
			parseSoundSearchParameters(
				new URLSearchParams({ commercial_only: value }),
			).success,
		).toBe(false);
	}
});

test("pagination and existing query validation are preserved", () => {
	const parsed = parseSoundSearchParameters(
		new URLSearchParams({
			q: "rain",
			page: "2",
			page_size: "50",
			sort: "score",
			type: "effects",
			commercial_only: "false",
		}),
	);
	if (!parsed.success) throw new Error("Expected valid query");
	expect(parsed.data).toEqual({
		q: "rain",
		page: 2,
		page_size: 50,
		sort: "score",
		type: "effects",
		min_rating: 3,
		commercial_only: false,
	});
	expect(
		parseSoundSearchParameters(new URLSearchParams("page=0")).success,
	).toBe(false);
});
