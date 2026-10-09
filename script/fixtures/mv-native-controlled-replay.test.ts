import { expect, test } from "bun:test";
import type {
	MvRecipePlan,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { MV_NATIVE_DOCUMENT } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-native-document";
import { nativeTestHost } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-native-test-host";
import { TestNativeBitmap } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-native-test-realm";
import { controlledNativeReplay } from "./mv-native-controlled-replay";

function request() {
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 30,
		seed: 1,
		recipe: {
			version: 1,
			songStartSeconds: 0,
			root: "solid",
			outputRoles: ["background"],
			post: [],
			nodes: [
				{
					id: "solid",
					scene: { kind: "solid", role: "background", color: [1, 0, 0, 1] },
				},
			],
		},
	};
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 0,
		clipDuration: 120000,
		trimStart: 0,
		timelineTime: 0,
	});
	if (!frame?.recipePlan) throw Error("Missing controlled fixture frame");
	return {
		source,
		frame: { ...frame, recipePlan: frame.recipePlan },
		resources: [],
	};
}

for (const mutate of [false, true])
	test(`controlled native fixture uses the exact document and ${mutate ? "mutated" : "unmodified"} fresh data`, async () => {
		const input = request();
		const canonical = structuredClone(input.frame.recipePlan);
		// Caller-supplied plans must be replaced BEFORE controlled corruption.
		Reflect.set(input.frame.recipePlan!.root, "color", [0, 0, 1, 1]);
		const host = nativeTestHost();
		let calls = 0;
		try {
			const pending = controlledNativeReplay({
				...input,
				...(mutate
					? {
							mutate(plan: MvRecipePlan) {
								calls++;
								expect(plan).toEqual(canonical);
								Reflect.set(plan.root, "color", [0, 1, 0, 1]);
							},
						}
					: {}),
			});
			void pending.catch(() => {});
			for (let i = 0; i < 64 && host.timerDelays.length === 0; i++)
				await Promise.resolve();
			expect(host.timerDelays).toEqual([5000]);
			expect(document.createElement("iframe").srcdoc).toBe(MV_NATIVE_DOCUMENT);
			host.emit("ready");
			const sent = host.sent[0]!.input as { frame: { recipePlan: unknown } };
			const expected = structuredClone(canonical);
			if (mutate) Reflect.set(expected!.root, "color", [0, 1, 0, 1]);
			expect(sent.frame.recipePlan).toEqual(expected);
			expect(calls).toBe(mutate ? 1 : 0);
			expect("mutate" in sent).toBe(false);
			expect("source" in sent).toBe(false);
			expect("code" in sent).toBe(false);
			const bitmap = new TestNativeBitmap(64, 64);
			host.emit("rendered", { bitmap });
			expect(await pending).toBe(bitmap);
			host.emit("disposed");
			expect(host.removed).toBe(true);
			bitmap.close();
		} finally {
			host.restore();
		}
	});

test("controlled parent mutator failure does not construct a raster realm", async () => {
	const host = nativeTestHost();
	try {
		await expect(
			controlledNativeReplay({
				...request(),
				mutate() {
					throw Error("test-only mutation failure");
				},
			}),
		).rejects.toThrow("test-only mutation failure");
		expect(host.timerDelays).toEqual([]);
		expect(host.sent).toEqual([]);
		expect(document.createElement("iframe").srcdoc).toBe("");
	} finally {
		host.restore();
	}
});
