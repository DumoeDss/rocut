import { expect, test } from "bun:test";
import {
	nativeTestInput,
	nativeTestRealm,
	TestNativeBitmap,
} from "./mv-native-test-realm";

function fixture() {
	const resource = {
		id: "heart",
		kind: "image",
		attachmentKey: "test",
		mimeType: "image/png",
		byteLength: 1,
		sha256: "a".repeat(64),
	};
	const node = {
		kind: "heartOwnerRequest",
		nodeId: "heart",
		role: "subject",
		request: { source: resource, frame: { scene: { kind: "heartShatter" } } },
	};
	const image = {
		width: 2,
		height: 3,
		binding: { source: resource },
		rgbaSha256: "b".repeat(64),
		part: { kind: "body" },
	};
	const bitmap = new TestNativeBitmap(2, 3);
	const command = {
		kind: "preparedImage",
		image,
		transform: [1, 0, 0, 1, 0, 0],
		operations: [],
		clip: null,
		sourceRect: [0, 0, 2, 3],
		destinationRect: [0, 0, 2, 3],
		composite: "source-over",
		opacity: 1,
		smoothing: true,
		smoothingQuality: "high",
	};
	const packet = {
		requestKey: JSON.stringify(node),
		frame: {
			identity: { binding: { source: resource } },
			plan: { commands: [command], rasterBudgetBytes: 1 },
		},
		images: [{ image, bitmap }],
	};
	const base = nativeTestInput();
	const input = {
		...base,
		frame: {
			...base.frame,
			recipePlan: {
				...base.frame.recipePlan,
				root: node,
				outputRoles: ["subject"],
			},
		},
		heartFrames: [packet],
		rasterByteLimit: 268435456,
	};
	return { input, packet, bitmap };
}
test("fixed realm adopts actual Heart packets, renders owner commands and closes transferred images", async () => {
	const { input, bitmap } = fixture(),
		realm = nativeTestRealm();
	realm.render(input);
	const result = await realm.result();
	expect(result.type).toBe("rendered");
	expect(realm.drawCalls).toBe(2);
	expect(bitmap.closed).toBe(true);
	expect(result.bitmap?.closed).toBe(false);
	expect(
		realm.surfaces.every(
			(surface) => surface.width === 1 && surface.height === 1,
		),
	).toBe(true);
	result.bitmap?.close();
});
test("request/source/variant/bitmap substitution fails closed and still releases transferred ownership", async () => {
	for (const change of [
		"request",
		"source",
		"variant",
		"dimensions",
		"duplicate",
	] as const) {
		const { input, packet, bitmap } = fixture(),
			realm = nativeTestRealm();
		if (change === "request") packet.requestKey = "{}";
		if (change === "source")
			packet.frame.identity.binding.source = {
				...packet.frame.identity.binding.source,
				sha256: "c".repeat(64),
			};
		if (change === "variant") Reflect.set(packet.frame, "kind", "skyShatter");
		if (change === "dimensions") packet.images[0]!.image.width++;
		if (change === "duplicate") packet.images.push(packet.images[0]!);
		realm.render(input);
		expect((await realm.result()).type).toBe("error");
		expect(bitmap.closed).toBe(true);
		expect(realm.surfaces).toHaveLength(0);
	}
});
test("resource identity survives Rust struct versus JSON-value property ordering", async () => {
	const { input, packet, bitmap } = fixture(),
		realm = nativeTestRealm();
	const resource = input.frame.recipePlan.root.request.source;
	input.frame.recipePlan.root.request.source = {
		sha256: resource.sha256,
		byteLength: resource.byteLength,
		mimeType: resource.mimeType,
		attachmentKey: resource.attachmentKey,
		kind: resource.kind,
		id: resource.id,
	};
	packet.requestKey = JSON.stringify(input.frame.recipePlan.root);
	realm.render(input);
	const result = await realm.result();
	expect(result.type).toBe("rendered");
	expect(realm.drawCalls).toBe(2);
	expect(bitmap.closed).toBe(true);
	result.bitmap?.close();
});
test("missing ready coverage does not accept a pending-owner plan", async () => {
	const { input, bitmap } = fixture(),
		realm = nativeTestRealm();
	input.heartFrames.length = 0;
	realm.render(input);
	expect((await realm.result()).error).toContain("coverage mismatch");
	expect(realm.surfaces).toHaveLength(0);
	bitmap.close();
});
