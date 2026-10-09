import { expect, test } from "bun:test";
import { withHyperframesAudioGraphAnalyzer } from "../programmatic/hyperframes-audio-analysis";
import {
	assertLifecycleBrowserRemoved,
	lifecycleBrowserEndpoint,
	ownedLifecycleBrowsers,
	type OwnedLifecycleBrowser,
} from "../../../../script/fixtures/hyperframes-audio-analysis-lifecycle-process";
import {
	lifecycleBounded,
	observeLifecycleBrowser,
} from "../../../../script/fixtures/hyperframes-audio-analysis-lifecycle-observer";
import {
	lifecycleTiming,
	withLifecycleProject,
} from "../../../../script/fixtures/hyperframes-audio-analysis-lifecycle-project";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const realWindowsTest = test.skipIf(process.platform !== "win32" || !toolchain);
function newlyOwned(executable: string, baseline: OwnedLifecycleBrowser[]) {
	const previous = new Set(baseline.map((browser) => browser.pid));
	const created = ownedLifecycleBrowsers(executable).filter(
		(browser) => !previous.has(browser.pid),
	);
	expect(created).toHaveLength(1);
	return created[0];
}

realWindowsTest(
	"in-flight real native seek abort exits private Chromium and releases its profile",
	async () => {
		await withLifecycleProject(
			toolchain!,
			async ({ source, options }, controller) => {
				const baseline = ownedLifecycleBrowsers(options.executable);
				let owned: OwnedLifecycleBrowser | undefined;
				let observer:
					| Awaited<ReturnType<typeof observeLifecycleBrowser>>
					| undefined;
				try {
					await withHyperframesAudioGraphAnalyzer(options, async (analyzer) => {
						owned = newlyOwned(options.executable, baseline);
						observer = await observeLifecycleBrowser(
							await lifecycleBrowserEndpoint(owned),
						);
						const { paused } = await observer.armNativeSeekPause();
						let settled = false;
						const outcome = analyzer.frame(lifecycleTiming(source, 3)).then(
							(value) => {
								settled = true;
								return { value, error: undefined };
							},
							(error: unknown) => {
								settled = true;
								return { value: undefined, error };
							},
						);
						try {
							const pause = await lifecycleBounded(
								paused,
								"Authored native seek did not enter its debugger checkpoint",
							);
							expect(pause.sessionId).toBeString();
							expect(settled).toBe(false);
							expect((await observer.pageIds()).length).toBeGreaterThan(1);
							controller.abort(
								Error("Intentional in-flight native frame abort"),
							);
							const result = await lifecycleBounded(
								outcome,
								"Aborted native frame did not reject",
							);
							expect(result.value).toBeUndefined();
							expect(result.error).toBeInstanceOf(Error);
							expect(String(result.error)).toMatch(
								/cancelled|closed|disconnected|abort/i,
							);
						} finally {
							controller.abort();
							await lifecycleBounded(
								outcome,
								"Pending frame survived lifecycle teardown",
							);
						}
					});
					expect(owned).toBeDefined();
					assertLifecycleBrowserRemoved(owned!);
					await lifecycleBounded(
						observer!.disconnected,
						"Aborted browser left observer connection open",
					);
					expect(ownedLifecycleBrowsers(options.executable)).toEqual(baseline);
				} finally {
					observer?.close();
				}
			},
		);
	},
	40000,
);

realWindowsTest(
	"consume failure preserves the error after real target and private Chromium cleanup",
	async () => {
		await withLifecycleProject(toolchain!, async ({ source, options }) => {
			const baseline = ownedLifecycleBrowsers(options.executable);
			const failure = Error("Intentional analyzer consume failure");
			let owned: OwnedLifecycleBrowser | undefined;
			let observer:
				| Awaited<ReturnType<typeof observeLifecycleBrowser>>
				| undefined;
			try {
				await expect(
					withHyperframesAudioGraphAnalyzer(options, async (analyzer) => {
						owned = newlyOwned(options.executable, baseline);
						observer = await observeLifecycleBrowser(
							await lifecycleBrowserEndpoint(owned),
						);
						const targets = await observer.pageIds();
						expect(targets.length).toBeGreaterThan(0);
						const result = await analyzer.frame(lifecycleTiming(source, 0));
						expect(result.frameIndex).toBe(0);
						expect(result.snapshot).toMatchObject({
							version: 1,
							nativeVersion: "0.8.139",
							time: 0,
						});
						expect(await observer.pageIds()).toEqual(targets);
						throw failure;
					}),
				).rejects.toBe(failure);
				expect(owned).toBeDefined();
				assertLifecycleBrowserRemoved(owned!);
				await lifecycleBounded(
					observer!.disconnected,
					"Consume failure left observer connection open",
				);
				expect(ownedLifecycleBrowsers(options.executable)).toEqual(baseline);
			} finally {
				observer?.close();
			}
		});
	},
	40000,
);
