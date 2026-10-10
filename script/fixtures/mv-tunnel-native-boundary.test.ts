import { expect, test } from "bun:test";
import {
	nativeTestInput,
	nativeTestRealm,
} from "../../packages/editor-classic/src/services/renderer/programmatic/mv-native-test-realm";

/** Synthetic interpreter/lifecycle facts only; no font/pixel parity claim. */
function input() {
	const base = nativeTestInput();
	const resources = ["primary", "fallback"].map((id, i) => ({
		resource: {
			id,
			kind: "font",
			attachmentKey: "test",
			mimeType: "font/ttf",
			byteLength: 1,
			sha256: String(i).repeat(64),
			font: {
				family: i ? "Noto Serif JP" : "DotGothic16",
				style: "normal",
				weight: 400,
			},
		},
		body: new ArrayBuffer(1),
	}));
	const fontStack = {
		role: "dot400",
		resources: resources.map((r) => r.resource),
		aliases: resources.map((r) => `mv-tunnel-${r.resource.sha256}-400`),
		routes: { Ō: "fallback" },
	};
	return {
		...base,
		nativePostMode: "scene-only",
		resources,
		frame: {
			...base.frame,
			tunnelFontStacks: [{ nodeId: "tunnel", fontStack }],
			recipePlan: {
				...base.frame.recipePlan,
				root: {
					kind: "tunnel",
					role: "foreground",
					nativePost: {
						profile: "tunnel-original-gl-v1",
						required: true,
						songTicks: 0,
					},
					data: {
						commands: [
							{
								kind: "stackText",
								fontStack,
								text: "Ō",
								fontSize: 100,
								tracking: 0,
								position: [0, 0],
								transform: [1, 0, 0, 1, 0, 0],
								operations: [],
								color: [1, 1, 1, 1],
								opacity: 1,
								composite: "source-over",
								align: "center",
								baseline: "middle",
							},
						],
					},
				},
			},
		},
	};
}
test("fixed native realm renders admitted alias stack without Worker crypto", async () => {
	const realm = nativeTestRealm();
	realm.render(input());
	const result = await realm.result();
	expect(result.type).toBe("rendered");
	expect(realm.fontAdds).toBe(4);
	expect(realm.fonts.size).toBe(0);
});
test("default native path cannot silently drop required original post", async () => {
	const realm = nativeTestRealm();
	realm.render({ ...input(), nativePostMode: undefined });
	const result = await realm.result();
	expect(result.type).toBe("error");
	expect(result.error).toContain("post receipt mismatch");
	expect(realm.messages.some((m) => m.type === "rendered")).toBe(false);
});
test("cancellation during dedicated alias load publishes no frame or late FontFace", async () => {
	let finish!: () => void;
	let began!: () => void;
	let count = 0;
	const started = new Promise<void>((resolve) => {
		began = resolve;
	});
	const realm = nativeTestRealm({
		loadFont: async () => {
			if (++count === 3) {
				began();
				await new Promise<void>((resolve) => {
					finish = resolve;
				});
			}
		},
	});
	realm.render(input());
	await started;
	realm.dispose();
	finish();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(realm.messages.map((m) => m.type)).toEqual(["ready", "disposed"]);
	expect(realm.fontAdds).toBe(2);
	expect(realm.fonts.size).toBe(0);
});
