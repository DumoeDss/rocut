import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { transformSync } from "esbuild";
import ts from "typescript";

// Execute the actual narrow production cleanup helpers with a recorded rm
// boundary. No real files are deleted and containment is not replaced by mocks.
for (const [file, name, prefix] of [
	[
		"../programmatic/engines/compile-project.ts",
		"cleanupEngineStaging",
		"rocut-engine-build-",
	],
	[
		"../programmatic/remotion-inspection-project.ts",
		"cleanupInspectionStaging",
		"rocut-remotion-inspect-",
	],
	[
		"./remotion-inspection-host.test.ts",
		"cleanupHostFixture",
		"rocut-inspection-host-",
	],
] as const) {
	test(`${name} preserves exact containment and observable rm failures`, async () => {
		const source = readFileSync(new URL(file, import.meta.url), "utf8");
		const parsed = ts.createSourceFile(
			file,
			source,
			ts.ScriptTarget.Latest,
			true,
		);
		const definition = parsed.statements.find(
			(statement): statement is ts.FunctionDeclaration =>
				ts.isFunctionDeclaration(statement) && statement.name?.text === name,
		);
		if (!definition) throw Error("Actual cleanup helper definition missing");
		const code = transformSync(definition.getText(parsed), {
			loader: "ts",
			target: "esnext",
		}).code;
		const calls: unknown[][] = [];
		const state: { failure?: Error } = {};
		const cleanup: unknown = new Function(
			"rm",
			"dirname",
			"basename",
			`${code}\nreturn ${name};`,
		)(
			async (...args: unknown[]) => {
				calls.push(args);
				if (state.failure) throw state.failure;
			},
			dirname,
			basename,
		);
		if (typeof cleanup !== "function")
			throw Error("Cleanup fixture helper missing");
		const run = (root: string) =>
			name === "cleanupHostFixture"
				? cleanup(root, parent)
				: cleanup({ staging: root, parent });
		const parent = "C:/fixture";
		for (const root of [
			"C:/",
			"C:/fixture",
			`C:/other/${prefix}test`,
			"C:/fixture/other-prefix",
		])
			await expect(run(root)).rejects.toThrow("Unsafe");
		expect(calls).toHaveLength(0);
		const target = `${parent}/${prefix}test`;
		await run(target);
		expect(calls).toEqual([[target, { recursive: true, force: true }]]);
		state.failure = Error("cleanup failed");
		await expect(run(target)).rejects.toThrow("cleanup failed");
	});
}
