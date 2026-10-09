import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

test("HTML capability is explicit, authenticated, unavailable without a browser and Rust-validated before launch", async () => {
	const parent = path.resolve(tmpdir());
	const root = await mkdtemp(path.join(parent, "rocut-html-route-"));
	const options = {
		projectRoot: path.join(root, "project"),
		registry: new TargetRegistry(path.join(root, "registry")),
	};
	let host = await startHost({ ...options, htmlBrowserExecutable: "" });
	const api = (route: string) => new URL(`api/${route}`, host.editorUrl);
	try {
		const catalog = await (await fetch(api("editing/catalog"))).json();
		expect(catalog.programmatic.runtimes).toEqual(["canvas-worker"]);
		expect(catalog.programmatic.htmlDocument.configured).toBe(false);
		const context = await (await fetch(api("context"))).json();
		expect(context.programmaticNativeAudio.configured).toBe(false);
		expect(context.programmaticNativeAudio.hyperframesGraph.configured).toBe(
			false,
		);
		expect(context.programmaticNativeAudio.hyperframesGraph.fxAutomation).toBe(
			"native-parameters-and-preset-mix-v1",
		);
		expect(
			context.programmaticNativeAudio.hyperframesGraph.unsupported,
		).not.toContain("fx-automation");
		expect(
			context.programmaticNativeAudio.hyperframesGraph.unsupported,
		).toContain("variable-rate");
		expect(
			(
				await fetch(api("programmatic/audio/identity"), {
					method: "POST",
					body: "{}",
				})
			).status,
		).toBe(503);
		expect(
			(
				await fetch(
					new URL("/wrong/api/programmatic/audio/identity", host.editorUrl),
					{ method: "POST", body: "{}" },
				)
			).status,
		).toBe(401);
		expect(
			(await fetch(api("programmatic/audio"), { method: "POST", body: "{}" }))
				.status,
		).toBe(503);
		expect(
			(
				await fetch(new URL("/wrong/api/programmatic/audio", host.editorUrl), {
					method: "POST",
					body: "{}",
				})
			).status,
		).toBe(401);
		expect(
			(await fetch(api("programmatic/frame"), { method: "POST", body: "{}" }))
				.status,
		).toBe(503);
		expect(
			(
				await fetch(new URL("/wrong/api/programmatic/frame", host.editorUrl), {
					method: "POST",
					body: "{}",
				})
			).status,
		).toBe(401);
		await host.close();
		// A real executable which is NOT Chromium: all inputs below must fail before spawn.
		host = await startHost({
			...options,
			htmlBrowserExecutable: process.execPath,
		});
		const enabled = await (await fetch(api("editing/catalog"))).json();
		expect(enabled.programmatic.htmlDocument.availability).toBe(
			"configured-not-health-probed",
		);
		for (const body of [
			"{",
			"null",
			"{}",
			JSON.stringify({ source: { runtime: "html-document", width: 999999 } }),
		]) {
			const result = await fetch(api("programmatic/frame"), {
				method: "POST",
				body,
			});
			expect(result.status).toBe(422);
		}
	} finally {
		await host.close();
		if (
			path.dirname(root) !== parent ||
			!path.basename(root).startsWith("rocut-html-route-")
		)
			throw Error("Invalid route fixture cleanup root");
		await rm(root, { recursive: true, force: true });
	}
});
