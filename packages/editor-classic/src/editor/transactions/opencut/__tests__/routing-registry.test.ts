import { expect, test } from "bun:test";
import { Command } from "../../../../commands/base-command";
import { classifyCommand, REGISTERED_COMMAND_NAMES } from "../routing";

test("every concrete command module has one exhaustive routing registration", async () => {
	const discovered: string[] = [];
	const glob = new Bun.Glob("packages/editor-classic/src/commands/**/*.ts");
	for await (const path of glob.scan({ cwd: process.cwd(), onlyFiles: true })) {
		const source = await Bun.file(path).text();
		for (const match of source.matchAll(/^export class (\w+Command) /gm)) {
			discovered.push(match[1]);
		}
	}
	expect([...REGISTERED_COMMAND_NAMES]).toEqual(
		[...new Set(discovered)].sort(),
	);
});

test("routing is independent of constructor names after production minification", () => {
	class o3 extends Command {
		readonly routingClass = "transaction" as const;

		execute() {
			return undefined;
		}
	}

	expect(classifyCommand(new o3())).toBe("transaction");
});
