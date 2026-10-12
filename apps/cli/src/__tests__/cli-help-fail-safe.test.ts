import { expect, test } from "bun:test";
import { runCli, USAGE_LINES } from "../main";
import { TargetRegistry } from "../target-registry";

test("command help returns without resolving any live target", async () => {
	const originalWrite = process.stdout.write;
	const originalResolve = TargetRegistry.prototype.resolve;
	let output = "";
	TargetRegistry.prototype.resolve = async () => {
		throw Error("Help must not resolve a target");
	};
	process.stdout.write = ((chunk: string | Uint8Array) => {
		output += Buffer.from(chunk).toString("utf8");
		return true;
	}) as typeof process.stdout.write;
	try {
		for (const argv of [
			["--help"],
			["export", "--help"],
			["snapshot", "--help"],
			["host", "start", "--help"],
			["programmatic", "compile", "--help"],
		]) {
			output = "";
			await runCli(argv);
			expect(output).toBe(USAGE_LINES.join("\n") + "\n");
		}
	} finally {
		process.stdout.write = originalWrite;
		TargetRegistry.prototype.resolve = originalResolve;
	}
});
