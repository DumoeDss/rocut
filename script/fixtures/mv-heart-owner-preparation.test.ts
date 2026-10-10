import { expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { resolve } from "node:path";
import {
	loadHeartOwnerReference,
	HEART_OWNER_REFERENCE_FILES,
} from "./mv-heart-owner-reference";
import { exposeHeartOwnerDrawBreak } from "./mv-heart-owner-browser-oracle";
import { HEART_OWNER_PROTOTYPE_TICKS } from "./mv-heart-owner-matrix";

test("prototype clock matrix retains both modes and twelve exact repeated seeks", () => {
	expect(HEART_OWNER_PROTOTYPE_TICKS.length * 2).toBe(48);
	expect(
		(HEART_OWNER_PROTOTYPE_TICKS.length -
			new Set(HEART_OWNER_PROTOTYPE_TICKS).size) *
			2,
	).toBe(12);
	for (const ticks of HEART_OWNER_PROTOTYPE_TICKS)
		expect(Number.isSafeInteger(ticks) && ticks >= 0 && ticks <= 600000).toBe(
			true,
		);
});
test("complete unchanged original scripts compile with only lexical native-context export appended", async () => {
	const root =
		process.env.ROCUT_TEST_MV_REFERENCE ??
		resolve("../vocaloid-style-mv-pipeline");
	const reference = await loadHeartOwnerReference(root);
	expect(reference.scripts.map((s) => s.id)).toEqual([
		...HEART_OWNER_REFERENCE_FILES,
	]);
	const context = createContext({
		window: {},
		console,
		URL,
		document: {
			baseURI: "https://rocut-heart-oracle.invalid/engine/index.html",
		},
	});
	for (const source of reference.scripts) {
		const code =
			source.id === "scenes/glass.js"
				? exposeHeartOwnerDrawBreak(source.code)
				: source.code;
		if (source.id === "scenes/glass.js") {
			const end = source.code.lastIndexOf("})();");
			expect(code).toBe(source.code.slice(0, end) +
				"window.__heartOwnerOracle={render:(canvas,sample,burn)=>drawBreak(canvas.getContext('2d'),sample,burn)};" +
				source.code.slice(end));
			expect(code.startsWith(source.code.slice(0, end))).toBe(true);
			expect(code.endsWith(source.code.slice(end))).toBe(true);
		}
		runInContext(code, context, { timeout: 5000 });
	}
	expect(runInContext("typeof window.__heartOwnerOracle.render", context)).toBe(
		"function",
	);
	expect(
		runInContext("window.__heartOwnerOracle.render.toString()", context),
	).toContain("canvas.getContext('2d')");
	expect(() => exposeHeartOwnerDrawBreak("missing closure")).toThrow();
	expect(
		(await loadHeartOwnerReference(root)).scripts.map((s) => s.sha256),
	).toEqual(reference.scripts.map((s) => s.sha256));
});
