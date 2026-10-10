import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	compileLiquidChild,
	executeTopLevel,
	toolchainRoot,
} from "./three-liquid-object-shared-compiler-fixture";

test("actual shared Liquid child bundles one installed Three and installs private listener before author side effect", async () => {
	const installed = JSON.parse(
		await readFile(
			join(toolchainRoot, "node_modules/three/package.json"),
			"utf8",
		),
	);
	expect(installed.version).toBe("0.185.1");
	const built = await compileLiquidChild({
		source: `
window.__authorObserved = {
  registrations: window.__testRegistrationCount(),
  claim: typeof window.claimLiquidObjectRuntime,
  service: typeof window.service,
  evaluate: typeof window.evaluate,
  runtime: typeof window.runtime,
};
addEventListener('message',()=>{}, {capture:true});
export async function createScene(){throw Error('VM must not render');}
`,
	});
	try {
		const result = executeTopLevel(built);
		expect(result.captureRegistrations).toEqual([true, true]);
		expect(result.sandbox.__authorObserved).toEqual({
			registrations: 1,
			claim: "undefined",
			service: "undefined",
			evaluate: "undefined",
			runtime: "undefined",
		});
		const rocut = result.sandbox.rocut;
		if (!rocut || typeof rocut !== "object" || !("renderFrame" in rocut))
			throw Error("Actual bundle did not publish the expected frame entry");
		expect(Object.keys(rocut)).toEqual(["renderFrame"]);
		expect(typeof rocut.renderFrame).toBe("function");
		expect(Object.hasOwn(result.sandbox, "claimLiquidObjectRuntime")).toBe(
			false,
		);
		await writeFile(
			join(built.root, "vm-receipt.json"),
			JSON.stringify(
				{
					ok: true,
					captureRegistrations: result.captureRegistrations,
					authorObserved: result.sandbox.__authorObserved,
					scope:
						"Fixture page config and VM transport only; actual bundle ordering, not Host/WASM/grant execution",
				},
				null,
				2,
			),
			{ flag: "wx" },
		);
	} catch (error) {
		await writeFile(join(built.root, "vm-failure.txt"), String(error), {
			encoding: "utf8",
			flag: "wx",
		});
		throw error;
	}
	console.log(
		JSON.stringify({
			actualSharedChild: true,
			root: built.root,
			vmTopLevelOnly: true,
		}),
	);
}, 30000);

test("actual shared child denies author static runtime import and private driver reentry", async () => {
	for (const source of [
		"import {claimLiquidObjectRuntime} from 'rocut:liquid-runtime'; window.stolen=claimLiquidObjectRuntime(); export function createScene(){}",
		"import 'rocut:liquid-driver'; export function createScene(){}",
	]) {
		let failure: unknown;
		try {
			await compileLiquidChild({ source });
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeDefined();
		if (
			!(failure instanceof Error) ||
			!("fixtureRoot" in failure) ||
			typeof failure.fixtureRoot !== "string"
		)
			throw Error(
				"Expected the original child rejection with its fixture root",
			);
		expect(failure.message).toMatch(/generated driver|private compiler entry/);
		expect(failure.fixtureRoot).toBeDefined();
		console.log(
			JSON.stringify({
				actualChildNegativeControl: true,
				root: failure.fixtureRoot,
			}),
		);
	}
}, 30000);
