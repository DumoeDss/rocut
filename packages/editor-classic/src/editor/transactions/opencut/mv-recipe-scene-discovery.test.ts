import { expect, test } from "bun:test";
import { mvRecipeSceneKinds } from "./mv-recipe-scene-discovery";

test("old binaries do not inherit new scene support from frontend code", () => {
	const kinds = mvRecipeSceneKinds({ generators: { ember: {} } });
	expect(kinds).toContain("illust");
	expect(kinds).toContain("ember");
	for (const kind of [
		"heartGather",
		"night",
		"memories",
		"burst",
		"illustNative",
	])
		expect(kinds).not.toContain(kind);
});

test("loaded owner and reference groups are discoverable without duplicates", () => {
	const kinds = mvRecipeSceneKinds({
		generators: { ember: {}, burst: {} },
		nativeOwnerScenes: { heartGather: {}, memories: {}, night: {} },
		referenceScenes: { burst: {}, illustNative: {} },
	});
	for (const kind of [
		"heartGather",
		"night",
		"memories",
		"burst",
		"illustNative",
	])
		expect(kinds).toContain(kind);
	expect(kinds.filter((kind) => kind === "burst")).toHaveLength(1);
});
