import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { request } from "./host-request";
import type { ResolvedTarget } from "./target-registry";

export async function runAgentCli({
	command,
	positional,
	resolved,
}: {
	command: string;
	positional: readonly string[];
	resolved: ResolvedTarget;
}) {
	const args = { positional };
	switch (command) {
		case "capabilities": {
			process.stdout.write(
				JSON.stringify(
					await request(resolved.secret, "GET", "context"),
					null,
					"\t",
				) + "\n",
			);
			return;
		}
		case "media": {
			if (args.positional[0] !== "import" || !args.positional[1])
				throw new Error("usage: rocut media import <spec.json>");
			const spec = JSON.parse(
				await readFile(resolve(args.positional[1]), "utf8"),
			);
			process.stdout.write(
				JSON.stringify(
					await request(resolved.secret, "POST", "media/import", spec),
					null,
					"\t",
				) + "\n",
			);
			return;
		}
		case "editing": {
			if (args.positional[0] !== "catalog")
				throw new Error("usage: rocut editing catalog");
			const catalog = await request(resolved.secret, "GET", "editing/catalog");
			process.stdout.write(
				JSON.stringify({ target: resolved.entry.id, catalog }, null, "\t") +
					"\n",
			);
			return;
		}
		case "task": {
			const [verb, input] = args.positional;
			let result: unknown;
			if (verb === "list")
				result = await request(resolved.secret, "GET", "editor-tasks");
			else if (verb === "start" && input)
				result = await request(
					resolved.secret,
					"POST",
					"editor-tasks",
					JSON.parse(await readFile(resolve(input), "utf8")),
				);
			else if (verb === "get" && input)
				result = await request(
					resolved.secret,
					"GET",
					`editor-tasks/${encodeURIComponent(input)}`,
				);
			else if (verb === "cancel" && input)
				result = await request(
					resolved.secret,
					"POST",
					`editor-tasks/${encodeURIComponent(input)}/cancel`,
					{},
				);
			else
				throw new Error(
					"usage: rocut task list|start <spec.json>|get <id>|cancel <id>",
				);
			process.stdout.write(
				JSON.stringify({ target: resolved.entry.id, result }, null, "\t") +
					"\n",
			);
			return;
		}
		case "scenes": {
			const verb = args.positional[0];
			let result: unknown;
			if (verb === "list")
				result = await request(resolved.secret, "GET", "scenes");
			else if (verb === "plan" && args.positional[1])
				result = await request(
					resolved.secret,
					"POST",
					"scenes/plan",
					JSON.parse(await readFile(args.positional[1], "utf8")),
				);
			else
				throw new Error(
					"usage: rocut scenes list | rocut scenes plan <spec.json>",
				);
			process.stdout.write(JSON.stringify(result, null, "\t") + "\n");
			return;
		}
		default:
			throw new Error("Unknown Agent command");
	}
}
