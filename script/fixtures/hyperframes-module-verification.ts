import { strict as assert } from "node:assert";

export interface ModuleCheck {
	name: string;
	actual: unknown;
	expected: unknown;
	passed: boolean;
}

/** Each result is derived from a real assertion, not an authored PASS constant. */
export function moduleCheck(
	checks: ModuleCheck[],
	name: string,
	actual: unknown,
	expected: unknown,
) {
	const result = {
		name,
		actual: structuredClone(actual),
		expected: structuredClone(expected),
		passed: false,
	};
	checks.push(result);
	assert.deepEqual(actual, expected, name);
	result.passed = true;
}

export const moduleUncoveredBoundaries = [
	"This ESM-only fixture does not establish image/font/media resource loading; the separate hyperframes-resource-acceptance fixture verifies that bridge.",
	"Classic-script dynamic import and query-specific import-map scopes are not covered by this ESM acceptance.",
	"Computed imports parse/archive all declared JavaScript/JSON module candidates; unrelated declared classic-only JavaScript may require a narrower module declaration contract.",
	".cjs filenames are parsed as browser ESM; Node CommonJS require/module interop is not provided.",
];
