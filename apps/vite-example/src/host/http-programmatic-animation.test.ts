import { expect, test } from "bun:test";
import { inspectHttpProgrammaticAnimation } from "./http-programmatic-animation";
import type { ProgrammaticResource } from "@opencut/editor-contracts";

test("animation adapter sends only resource to the fixed authenticated route and preserves abort", async () => {
	const original = globalThis.fetch;
	const controller = new AbortController();
	const resource = { id: "model.glb" } as ProgrammaticResource;
	const catalog = { version: 1, clips: [] };
	try {
		globalThis.fetch = (async (
			url: Parameters<typeof fetch>[0],
			options?: Parameters<typeof fetch>[1],
		) => {
			expect(url).toBe("/owned/api/programmatic/animation-inspect");
			expect(options?.method).toBe("POST");
			expect(options?.signal).toBe(controller.signal);
			expect(JSON.parse(options?.body as string)).toEqual({ resource });
			return Response.json(catalog);
		}) as unknown as typeof fetch;
		expect(
			await inspectHttpProgrammaticAnimation({
				base: "/owned/api/",
				resource,
				signal: controller.signal,
			}),
		).toEqual(catalog);
		globalThis.fetch = (async () =>
			Response.json(
				{ error: "Fixed Three animation catalog module unavailable" },
				{ status: 422 },
			)) as unknown as typeof fetch;
		await expect(
			inspectHttpProgrammaticAnimation({
				base: "api",
				resource,
				signal: controller.signal,
			}),
		).rejects.toThrow("Fixed Three animation catalog module unavailable");
		controller.abort(Error("cancelled"));
		await expect(
			inspectHttpProgrammaticAnimation({
				base: "api",
				resource,
				signal: controller.signal,
			}),
		).rejects.toThrow("cancelled");
	} finally {
		globalThis.fetch = original;
	}
});
