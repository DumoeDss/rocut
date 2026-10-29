import { expect, mock, test } from "bun:test";
import {
	projectId,
	revisionOf,
	type TransactionRead,
} from "@opencut/editor-contracts";
if (process.env.ROCUT_MEDIA_INSTANCE_LIVE_CHILD !== "1") {
	test("media instance source verification runs in an isolated Native transport fixture", () => {
		const child = Bun.spawnSync({
			cmd: [process.execPath, "test", import.meta.path],
			env: { ...process.env, ROCUT_MEDIA_INSTANCE_LIVE_CHILD: "1" },
		});
		if (child.exitCode !== 0)
			throw Error(new TextDecoder().decode(child.stderr));
		expect(child.exitCode).toBe(0);
	});
} else {
	mock.module("opencut-wasm", () => ({
		validateSceneStateJson: () => "[]",
		planSceneMutationJson: () => "{}",
		queryMediaInstanceClockJson: (input: string) => {
			const parsed = JSON.parse(input);
			return JSON.stringify({
				status: "ready",
				nativeRevision: parsed.document.revision,
				sceneTick: parsed.request.sceneTick,
				requiredSources: [{ assetId: "video", sourceSha256: "a".repeat(64) }],
			});
		},
	}));
	const { queryMediaInstanceClock } = await import("../media-instance-clock");
	const { musicGridStoredSourceProbe } =
		await import("../../../../../../../apps/cli/src/music-grid-source");
	function owner() {
		let rev = revisionOf(3);
		const engine: TransactionRead = {
			revision: async () => rev,
			project: async () => ({
				id: projectId("project"),
				name: "Fixture",
				frameRate: { numerator: 30, denominator: 1 },
				canvasWidth: 32,
				canvasHeight: 24,
			}),
			tracks: async () => [],
			clips: async () => [],
			assets: async () => [],
			markers: async () => [],
		};
		return {
			engine,
			move: () => {
				rev = revisionOf(rev + 1);
			},
		};
	}
	test("offline, missing and unknown actual source availability cannot become a mapped proof", async () => {
		const { engine } = owner();
		expect(
			(
				await queryMediaInstanceClock({
					engine,
					request: { sceneTick: 120001 },
				})
			).status,
		).toBe("unavailable");
		for (const state of ["unknown", "unavailable"] as const)
			expect(
				(
					await queryMediaInstanceClock({
						engine,
						request: { sceneTick: 120001 },
						sourceAvailability: async () => state,
					})
				).status,
			).toBe("unavailable");
		const probe = mock(async () => "available" as const);
		expect(
			(
				await queryMediaInstanceClock({
					engine,
					request: { sceneTick: 120001 },
					sourceAvailability: probe,
				})
			).sceneTick,
		).toBe(120001);
		expect(probe).toHaveBeenCalledWith({
			assetId: "video",
			sourceSha256: "a".repeat(64),
		});
	});
	test("owner revision changing during attachment verification prevents publication", async () => {
		const { engine, move } = owner();
		expect(
			(
				await queryMediaInstanceClock({
					engine,
					request: {},
					sourceAvailability: async () => {
						move();
						return "available";
					},
				})
			).status,
		).toBe("conflict");
	});
	test("stored attachment hash is computed from actual bytes and altered/missing bytes fail", async () => {
		const bytes = new TextEncoder().encode("retained video bytes");
		let body: Uint8Array | undefined = bytes;
		const store = {
			loadAttachment: async () =>
				body
					? {
							body: Uint8Array.from(body).buffer,
							projectId: projectId("project"),
							key: "video",
							metadata: {},
						}
					: null,
		};
		const probe = musicGridStoredSourceProbe({ store, projectId: "project" });
		const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
		expect(await probe({ assetId: "video", sourceSha256: hash })).toBe(
			"available",
		);
		body = new TextEncoder().encode("changed bytes");
		expect(await probe({ assetId: "video", sourceSha256: hash })).toBe(
			"unavailable",
		);
		body = undefined;
		expect(await probe({ assetId: "video", sourceSha256: hash })).toBe(
			"unavailable",
		);
	});
}
