import { describe, expect, test } from "bun:test";
import { MV_NATIVE_DOCUMENT } from "./mv-native-document";
import { isMvNativeEnvelope, MV_NATIVE_PROTOCOL } from "./mv-native-protocol";
import {
	nativeTestInput,
	nativeTestRealm,
	TestNativeBitmap,
} from "./mv-native-test-realm";

describe("fixed native MV raster realm", () => {
	test("contains fixed source only and forbids eval/network/Worker capability", () => {
		expect(MV_NATIVE_DOCUMENT).toContain("default-src 'none'");
		for (const capability of [
			"worker",
			"connect",
			"img",
			"media",
			"font",
			"frame",
			"object",
		])
			expect(MV_NATIVE_DOCUMENT).toContain(`${capability}-src 'none'`);
		expect(MV_NATIVE_DOCUMENT).not.toMatch(
			/unsafe-eval|new Function|AsyncFunction|\beval\s*\(|source\.code/,
		);
		expect(MV_NATIVE_DOCUMENT.match(/<script>/g)).toHaveLength(1);
		expect(MV_NATIVE_DOCUMENT.match(/<\/script>/g)).toHaveLength(1);
	});

	test("response identities are not interchangeable with generic Worker messages", () => {
		const envelope = {
			protocol: MV_NATIVE_PROTOCOL,
			requestId: "one",
			type: "ready",
		};
		expect(isMvNativeEnvelope(envelope, "one")).toBe(true);
		expect(isMvNativeEnvelope(envelope, "two")).toBe(false);
		expect(isMvNativeEnvelope("ready", "one")).toBe(false);
		expect(
			isMvNativeEnvelope({ ...envelope, protocol: "rocut-frame-v1" }, "one"),
		).toBe(false);
		expect(isMvNativeEnvelope({ ...envelope, type: "render" }, "one")).toBe(
			false,
		);
	});

	test("renders through HTML surfaces, transfers one owned result and clears scratch", async () => {
		const realm = nativeTestRealm();
		realm.dispose("another-request");
		expect(realm.port.closed).toBe(false);
		realm.render(nativeTestInput());
		const result = await realm.result();
		expect(result.type).toBe("rendered");
		expect([result.bitmap?.width, result.bitmap?.height]).toEqual([16, 9]);
		expect(result.bitmap?.closed).toBe(false);
		expect(realm.surfaces.length).toBeGreaterThanOrEqual(2);
		expect(
			realm.surfaces.every(
				(surface) => surface.width === 1 && surface.height === 1,
			),
		).toBe(true);
		realm.render(nativeTestInput());
		expect(
			realm.messages.filter((message) => message.type === "rendered"),
		).toHaveLength(1);
		realm.dispose();
		expect(realm.port.closed).toBe(true);
		result.bitmap?.close();
	});

	test("rejects script-bearing envelope fields rather than evaluating them", async () => {
		const realm = nativeTestRealm();
		realm.render({
			...nativeTestInput(),
			source: { code: "throw Error('executed')" },
		});
		const result = await realm.result();
		expect(result.type).toBe("error");
		expect(result.error).toContain("Invalid native MV payload");
		expect(realm.surfaces).toHaveLength(0);
	});

	test("closes an image that finishes decoding after disposal", async () => {
		let complete!: (bitmap: TestNativeBitmap) => void;
		let began!: () => void;
		const started = new Promise<void>((resolve) => {
			began = resolve;
		});
		const realm = nativeTestRealm({
			decode: async () => {
				began();
				return new Promise((resolve) => {
					complete = resolve;
				});
			},
		});
		const input = nativeTestInput();
		const resource = {
			id: "image",
			kind: "image",
			attachmentKey: "test",
			mimeType: "image/png",
			byteLength: 1,
			sha256: "a".repeat(64),
		};
		input.resources.push({ resource, body: new ArrayBuffer(1) });
		input.imageAdmissions.push({
			resource,
			width: 1,
			height: 1,
			decodedBytes: 4,
		});
		realm.render(input);
		await started;
		realm.dispose();
		const bitmap = new TestNativeBitmap(1, 1);
		complete(bitmap);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(bitmap.closed).toBe(true);
		expect(realm.messages.map((message) => message.type)).toEqual([
			"ready",
			"disposed",
		]);
		expect(realm.surfaces).toHaveLength(0);
	});

	test("does not add a font that loads after cancellation", async () => {
		let complete!: () => void;
		let began!: () => void;
		const started = new Promise<void>((resolve) => {
			began = resolve;
		});
		const realm = nativeTestRealm({
			loadFont: async () => {
				began();
				return new Promise<void>((resolve) => {
					complete = resolve;
				});
			},
		});
		const input = nativeTestInput();
		input.resources.push({
			resource: {
				id: "font",
				kind: "font",
				byteLength: 1,
				font: { family: "Test", style: "normal", weight: 400 },
			},
			body: new ArrayBuffer(1),
		});
		realm.render(input);
		await started;
		realm.dispose();
		complete();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(realm.fontAdds).toBe(0);
		expect(realm.fonts.size).toBe(0);
		expect(realm.messages.map((message) => message.type)).toEqual([
			"ready",
			"disposed",
		]);
	});

	test("cooperative cancellation unwinds a partially rendered Ember plan", async () => {
		const realm = nativeTestRealm({ onYield: () => realm.dispose() });
		const input = nativeTestInput();
		const command = {
			kind: "rect",
			transform: [1, 0, 0, 1, 0, 0],
			rect: [0, 0, 1, 1],
			paint: {
				kind: "fill",
				style: { kind: "solid", color: [1, 0, 0, 1] },
				opacity: 1,
				composite: "source-over",
			},
		};
		const root = {
			kind: "ember",
			role: "foreground",
			data: { commands: Array.from({ length: 130 }, () => command) },
		};
		realm.render({
			...input,
			frame: {
				...input.frame,
				recipePlan: { ...input.frame.recipePlan, root },
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 15));
		expect(realm.yields).toBe(1);
		expect(realm.drawCalls).toBeGreaterThan(0);
		expect(realm.drawCalls).toBeLessThan(130);
		expect(
			realm.surfaces.every(
				(surface) => surface.width === 1 && surface.height === 1,
			),
		).toBe(true);
		expect(realm.messages.map((message) => message.type)).toEqual([
			"ready",
			"disposed",
		]);
	});
});
