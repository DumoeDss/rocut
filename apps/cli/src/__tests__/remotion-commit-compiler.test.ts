import { expect, test } from "bun:test";
import {
	captureNativeCommitSeam,
	nativeCommitFixtureSource,
	nativeCommitToolchain,
	pinnedNativeCommitFixtureSource,
} from "./remotion-commit-compiler-fixture";

(nativeCommitToolchain ? test : test.skip)(
	"compiler exposes the same native context and adds only a rendering-content sentinel",
	async () => {
		const result = await captureNativeCommitSeam();
		expect(result.code).toBe(0);
		expect(result.error).toBe("");
		expect(result.native).toContain(
			"if (environment.isStudio && video) return jsx22(Comp, {});",
		);
		expect(result.native).toContain(
			"fallback: /* @__PURE__ */ jsx22(Fallback, {}),",
		);
		expect(result.native).toContain(
			"children: jsx22(RocutCompositionCommit, {id, children: jsx22(Comp,",
		);
		expect(result.native).toContain(
			"RocutCompositionCommitContext as __rocutCompositionCommitContext",
		);
		expect(result.native).toContain("window.rocutOffthread.fetch(actualSrc, {");
	},
);

(nativeCommitToolchain ? test : test.skip)(
	"compiler rejects changed version, branch, content and fallback rather than silently losing commit authority",
	async () => {
		const native = await pinnedNativeCommitFixtureSource();
		const cases = [
			{ version: "4.0.441" },
			{
				native: native.replace(
					"var InnerComposition = ",
					"var ChangedInner = ",
				),
			},
			{
				native: native.replace("video.id === id", "video.id !== id"),
			},
			{
				native: native.replace("jsx22(Comp, {\n", "jsx22(Other, {\n"),
			},
			{
				native: native.replace(
					"jsx22(Fallback, {})",
					"jsx22(OtherFallback, {})",
				),
			},
			{ native: native + "\n" + nativeCommitFixtureSource },
		];
		for (const changed of cases) {
			const result = await captureNativeCommitSeam(changed);
			expect(result.code).not.toBe(0);
			expect(result.error).toContain("Pinned Remotion composition commit");
			expect(result.native).toBeNull();
		}
		const metadataDrift = await captureNativeCommitSeam({
			native: native.replace("metadata.expectedDisplayTime - now", "0 - now"),
		});
		expect(metadataDrift.code).not.toBe(0);
		expect(metadataDrift.error).toContain(
			"Pinned Remotion native video observer seam changed",
		);
		expect(metadataDrift.native).toBeNull();
	},
);
