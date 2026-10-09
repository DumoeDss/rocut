import { expect, test } from "bun:test";
import { particlePageErrorMessage } from "../programmatic/particle-browser-error";
import { ParticleSurfaceError } from "../programmatic/particle-client";

test("page diagnostics retain nested primary, Rust code/path and author cleanup causes", () => {
	const rust = new ParticleSurfaceError(
		JSON.stringify({
			version: 1,
			ok: false,
			error: {
				code: "degenerate",
				path: "triangles[0].position",
				message: "Triangle has no area",
			},
		}),
	);
	const cleanup = new AggregateError(
		[Error("author-dispose-sentinel")],
		"Three particle scene cleanup failed",
	);
	const result = particlePageErrorMessage(
		new AggregateError([rust, cleanup], "Particle page and cleanup failed", {
			cause: rust,
		}),
	);
	expect(result).toContain(
		"Rust degenerate at triangles[0].position: Triangle has no area",
	);
	expect(result).toContain("author-dispose-sentinel");
	expect(result.match(/Triangle has no area/g)).toHaveLength(1);
});

test("page diagnostics bound cycles, depth, fanout and throwing accessors", () => {
	const cycle = new Error("cycle") as Error & { cause?: unknown };
	cycle.cause = cycle;
	expect(particlePageErrorMessage(cycle)).toBe("Error: cycle");
	const wide = new AggregateError(
		Array.from({ length: 100 }, (_, i) => Error(`${i}: ${"x".repeat(10000)}`)),
		"wide",
	);
	expect(particlePageErrorMessage(wide).length).toBeLessThanOrEqual(1000);
	expect(particlePageErrorMessage(wide)).not.toContain("5: ");
	const hostile = Object.defineProperties(
		{},
		{
			message: {
				get() {
					throw Error("getter");
				},
			},
			toString: {
				value() {
					throw Error("toString");
				},
			},
		},
	);
	expect(particlePageErrorMessage(hostile)).toBe("Unprintable particle error");
});
