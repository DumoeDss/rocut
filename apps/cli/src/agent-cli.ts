import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isProgrammaticSource } from "@opencut/editor-contracts";
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
			const action = args.positional[0];
			if (!["import", "import-status"].includes(action) || !args.positional[1])
				throw new Error("usage: rocut media import|import-status <spec.json>");
			const spec = JSON.parse(
				await readFile(resolve(args.positional[1]), "utf8"),
			);
			process.stdout.write(
				JSON.stringify(
					await request(resolved.secret, "POST", `media/${action}`, spec),
					null,
					"\t",
				) + "\n",
			);
			return;
		}
		case "resource": {
			if (
				args.positional[0] !== "import" ||
				!args.positional[1] ||
				args.positional.length !== 2
			)
				throw new Error("usage: rocut resource import <spec.json>");
			const spec = JSON.parse(
				await readFile(resolve(args.positional[1]), "utf8"),
			);
			const result = await request(
				resolved.secret,
				"POST",
				"programmatic/resources/import",
				spec,
			);
			process.stdout.write(JSON.stringify(result, null, "\t") + "\n");
			return;
		}
		case "programmatic": {
			const [action, file] = args.positional;
			if (
				![
					"compile",
					"rebuild",
					"revise",
					"inspect",
					"compile-inspected",
					"audio-import",
					"sequence-import",
					"sequence-restore",
					"model-restore",
					"source-restore",
					"produced",
					"object-params",
					"animation-inspect",
				].includes(action) ||
				!file ||
				args.positional.length !== 2
			)
				throw Error(
					"usage: rocut programmatic compile|rebuild|revise|inspect|compile-inspected|audio-import|sequence-import|sequence-restore|model-restore|source-restore|produced|object-params|animation-inspect <spec.json>",
				);
			const input = JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(
					await readFile(resolve(file)),
				),
			);
			const route =
				action === "animation-inspect"
					? "programmatic/animation-inspect"
					: action === "object-params"
						? "programmatic/object-params"
						: action === "produced"
							? "programmatic/produced"
							: action === "audio-import"
								? "programmatic/resources/import-audio"
								: action === "sequence-import"
									? "programmatic/resources/import-image-sequence"
									: action === "sequence-restore"
										? "programmatic/resources/restore-image-sequence-source"
										: action === "model-restore"
											? "programmatic/resources/restore-model-source"
											: action === "source-restore"
												? "programmatic/resources/restore-build-source"
												: `programmatic/build/${action}`;
			const result = await request(resolved.secret, "POST", route, input);
			if (
				action === "revise" &&
				(!result ||
					typeof result !== "object" ||
					Array.isArray(result) ||
					Object.keys(result).length !== 2 ||
					!("source" in result) ||
					!isProgrammaticSource(result.source) ||
					!("reusedDocument" in result) ||
					typeof result.reusedDocument !== "boolean")
			)
				throw Error("Invalid programmatic build revision response");
			process.stdout.write(JSON.stringify(result, null, "\t") + "\n");
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
