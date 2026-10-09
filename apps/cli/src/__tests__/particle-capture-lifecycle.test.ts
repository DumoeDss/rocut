import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	createParticleCaptureIdentity,
	assertParticleCaptureSnapshot,
	raceParticleCapture,
	withHtmlCaptureCleanup,
} from "../programmatic/particle-capture";
import { deferred } from "./particle-broker-test-support";
import {
	captureHtmlBrowserFrame,
	htmlBrowserException,
} from "../programmatic/particle-capture-frame";

const digest = (value: Uint8Array) =>
	createHash("sha256").update(value).digest("hex");
function identityInput() {
	const body = new Uint8Array([1, 2, 3]).buffer;
	return {
		session: "session",
		code: "<script>scene()</script>",
		archiveIdentityHash: "a".repeat(64),
		frame: {
			frame: 5,
			time: 0.125,
			seed: 42,
			resourceLimits: { maxBytes: 123 },
		},
		resources: [
			{
				resource: {
					id: "model",
					kind: "model" as const,
					mimeType: "model/gltf-binary",
					byteLength: 3,
					sha256: digest(new Uint8Array(body)),
					attachmentKey: "content-addressed-model",
				},
				body,
			},
		],
	};
}

test("capture identity binds actual code, verified descriptor/bytes, archive and all Rust frame fields", () => {
	const input = identityInput();
	const first = createParticleCaptureIdentity(input);
	const again = createParticleCaptureIdentity(input);
	expect(first.sourceId).toBe(again.sourceId);
	expect(first.frameId).toBe(again.frameId);
	expect(first.captureId).not.toBe(again.captureId);
	expect(Object.isFrozen(first)).toBe(true);
	expect(
		createParticleCaptureIdentity({ ...input, code: input.code + " " })
			.sourceId,
	).not.toBe(first.sourceId);
	expect(
		createParticleCaptureIdentity({
			...input,
			archiveIdentityHash: "b".repeat(64),
		}).sourceId,
	).not.toBe(first.sourceId);
	expect(
		createParticleCaptureIdentity({
			...input,
			frame: { ...input.frame, resourceLimits: { maxBytes: 124 } },
		}).frameId,
	).not.toBe(first.frameId);
	expect(
		createParticleCaptureIdentity({
			...input,
			frame: {
				seed: 42,
				time: 0.125,
				frame: 5,
				resourceLimits: { maxBytes: 123 },
			},
		}).frameId,
	).toBe(first.frameId);
	const changed = identityInput();
	changed.resources[0]!.resource.mimeType = "application/octet-stream";
	expect(createParticleCaptureIdentity(changed).sourceId).not.toBe(
		first.sourceId,
	);
	new Uint8Array(input.resources[0]!.body)[0] = 9;
	expect(() => createParticleCaptureIdentity(input)).toThrow(
		"changed after verification",
	);
});

test("identity refuses incomplete non-JSON frames and duplicate resource identities", () => {
	for (const frame of [
		undefined,
		{ time: NaN },
		{ time: undefined },
		{ frame: Infinity },
		new Array(2),
	])
		expect(() =>
			createParticleCaptureIdentity({ ...identityInput(), frame }),
		).toThrow();
	const input = identityInput();
	input.resources.push(input.resources[0]!);
	expect(() => createParticleCaptureIdentity(input)).toThrow(
		"resource identity",
	);
});

test("resource or Rust frame mutation while the sampler starts is rejected before page serialization", () => {
	const input = identityInput();
	const expected = createParticleCaptureIdentity(input);
	// A new capture nonce alone does not invalidate the stable snapshot identity.
	expect(() => assertParticleCaptureSnapshot(expected, input)).not.toThrow();
	input.frame.seed++;
	expect(() => assertParticleCaptureSnapshot(expected, input)).toThrow(
		"changed before page serialization",
	);
	input.frame.seed--;
	new Uint8Array(input.resources[0]!.body)[0] = 8;
	expect(() => assertParticleCaptureSnapshot(expected, input)).toThrow(
		"changed after verification",
	);
	// Even a concurrent descriptor replacement cannot silently move the grant.
	input.resources[0]!.resource.sha256 = digest(
		new Uint8Array(input.resources[0]!.body),
	);
	expect(() => assertParticleCaptureSnapshot(expected, input)).toThrow(
		"changed before page serialization",
	);
});

test("capture cleanup awaits page, both independent brokers and browser before returning", async () => {
	const events: string[] = [];
	const particle = deferred<void>();
	const native = deferred<void>();
	const cleaning = deferred<void>();
	let returned = false;
	const result = withHtmlCaptureCleanup({
		async run() {
			events.push("capture");
			return "png";
		},
		async cleanupPage() {
			events.push("page");
		},
		disposeBrokers: [
			async () => {
				events.push("particle");
				cleaning.resolve();
				await particle.promise;
			},
			async () => {
				events.push("native");
				await native.promise;
			},
		],
		async closeBrowser() {
			events.push("browser");
		},
	}).then((value) => {
		returned = true;
		return value;
	});
	await cleaning.promise;
	expect(events).toEqual(["capture", "page", "particle", "native"]);
	particle.resolve();
	await Promise.resolve();
	expect(returned).toBe(false);
	native.resolve();
	expect(await result).toBe("png");
	expect(events.at(-1)).toBe("browser");
});

test("every cleanup runs and primary failure remains first and cause", async () => {
	const primary = Error("author failed");
	const page = Error("page failed"),
		particle = Error("particle failed"),
		native = Error("native failed"),
		browser = Error("browser failed");
	const events: string[] = [];
	const result = await withHtmlCaptureCleanup({
		async run() {
			throw primary;
		},
		async cleanupPage() {
			events.push("page");
			throw page;
		},
		disposeBrokers: [
			async () => {
				events.push("particle");
				throw particle;
			},
			async () => {
				events.push("native");
				throw native;
			},
		],
		async closeBrowser() {
			events.push("browser");
			throw browser;
		},
	}).catch((error: unknown) => error);
	expect(events).toEqual(["page", "particle", "native", "browser"]);
	expect(result).toBeInstanceOf(AggregateError);
	expect((result as AggregateError).cause).toBe(primary);
	expect((result as AggregateError).errors).toEqual([
		primary,
		page,
		particle,
		native,
		browser,
	]);
});

test("an otherwise successful PNG is rejected when cleanup fails", async () => {
	const cleanup = Error("cleanup");
	await expect(
		withHtmlCaptureCleanup({
			async run() {
				return "must not escape";
			},
			async cleanupPage() {
				throw cleanup;
			},
			disposeBrokers: [],
			async closeBrowser() {},
		}),
	).rejects.toBe(cleanup);
});

test("failure races evaluate and screenshot even if page/CDP work never settles", async () => {
	for (const stage of ["evaluate", "screenshot"]) {
		const failure = deferred<never>();
		const capture = raceParticleCapture(new Promise<string>(() => {}), [
			failure.promise,
		]);
		failure.reject(Error(stage + " failed"));
		await expect(capture).rejects.toThrow(stage + " failed");
	}
});

test("the production capture seam waits for evaluation and four host/page checks around PNG capture", async () => {
	const calls: string[] = [];
	let checks = 0;
	const png = await captureHtmlBrowserFrame({
		expression: "await GPU and sampling",
		executionContextId: 17,
		signal: new AbortController().signal,
		failures: [],
		beforeEvaluate() {
			calls.push("start");
		},
		async check() {
			calls.push(`check-${++checks}`);
		},
		async send(method, params) {
			calls.push(method);
			if (method === "Runtime.evaluate") {
				expect(params).toMatchObject({
					contextId: 17,
					awaitPromise: true,
					returnByValue: true,
				});
			}
			return method === "Page.captureScreenshot"
				? { data: Buffer.from("test-only-png-bytes").toString("base64") }
				: {};
		},
	});
	expect(png.toString()).toBe("test-only-png-bytes");
	expect(calls).toEqual([
		"check-1",
		"start",
		"Runtime.evaluate",
		"check-2",
		"Page.getLayoutMetrics",
		"check-3",
		"Page.captureScreenshot",
		"check-4",
	]);
});

test("page check and disposal reasons survive CDP wrapping with bounded output", () => {
	const error = htmlBrowserException("Particle page cleanup failed", {
		text: "Uncaught",
		exception: {
			description: "Error: author-dispose-sentinel\n" + "x".repeat(5000),
		},
	});
	expect(error.message).toContain("author-dispose-sentinel");
	expect(error.message.length).toBeLessThan(1300);
	expect(error.cause).toBeInstanceOf(Error);
	expect((error.cause as Error).message).toContain("author-dispose-sentinel");
	expect(
		htmlBrowserException("check", { exception: { value: "thrown string" } })
			.message,
	).toContain("thrown string");
	expect(
		htmlBrowserException("check", { text: "page check sentinel" }).message,
	).toContain("page check sentinel");
});
