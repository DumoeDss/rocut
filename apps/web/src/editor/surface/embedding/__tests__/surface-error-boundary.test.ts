import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSurfaceErrorReporter } from "../surface-error-boundary";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("Surface error containment", () => {
	test("reports the same Error once through the latest callback", () => {
		const report = createSurfaceErrorReporter();
		const error = new Error("render failed");
		const first: Error[] = [];
		const latest: Error[] = [];
		report({ value: error, onError: (value) => first.push(value) });
		report({ value: error, onError: (value) => latest.push(value) });
		expect(first).toEqual([error]);
		expect(latest).toEqual([]);
	});

	test("reports distinct errors and normalizes non-Error throws", () => {
		const report = createSurfaceErrorReporter();
		const values: Error[] = [];
		report({
			value: new Error("first"),
			onError: (value) => values.push(value),
		});
		report({
			value: new Error("first"),
			onError: (value) => values.push(value),
		});
		report({
			value: { secret: "must not render" },
			onError: (value) => values.push(value),
		});
		expect(values).toHaveLength(3);
		expect(values[2]?.message).toBe("The editor could not render.");
	});

	test("keeps unique labelled alerts contained without lifecycle disposal", () => {
		const boundary = readFileSync(
			resolve(HERE, "../surface-error-boundary.tsx"),
			"utf8",
		);
		const surface = readFileSync(
			resolve(HERE, "../editor-surface.tsx"),
			"utf8",
		);
		expect(boundary).toContain("titleId={useId()}");
		expect(boundary).toContain('role="alert"');
		expect(boundary).toContain("aria-labelledby={this.props.titleId}");
		expect(boundary).not.toMatch(
			/stack|JSON\.stringify|dispose|session\.unmount/,
		);
		expect(surface.indexOf("<SurfaceErrorBoundary")).toBeLessThan(
			surface.indexOf("<SurfacePortalProvider"),
		);
		expect(surface).toContain("cleanup();");
		expect(surface).not.toContain("session.dispose");
	});
});
