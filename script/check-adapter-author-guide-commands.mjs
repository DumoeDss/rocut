#!/usr/bin/env node
/** Fail-closed pairing between guide command ids and author-runner steps. */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GUIDE_PATH = join(REPO_ROOT, "docs", "adapter-authors", "README.md");
const RUNNER_PATH = join(
	REPO_ROOT,
	"script",
	"run-adapter-author-template.mjs",
);

function repeated(values) {
	const counts = new Map();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts].filter(([, count]) => count !== 1);
}

function normalizeCommand(command) {
	return command.trim().replace(/\s+/g, " ");
}

function parseGuide(text) {
	const fenced = [...text.matchAll(/```(?:sh|bash|shell)\s*\n[\s\S]*?```/g)];
	const paired = [
		...text.matchAll(
			/<!--\s*opencut-command-id:\s*([a-z0-9][a-z0-9/-]*)\s*-->\s*```(?:sh|bash|shell)\s*\n([\s\S]*?)```/g,
		),
	].map((match) => ({ id: match[1], command: match[2].trim() }));
	return {
		commands: paired,
		unpairedFenceCount: fenced.length - paired.length,
	};
}

function parseRunner(text) {
	const commandArray =
		/export const ADAPTER_AUTHOR_COMMANDS = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(
			text,
		)?.[1];
	if (commandArray === undefined) {
		throw new Error("runner has no ADAPTER_AUTHOR_COMMANDS declaration");
	}
	const runnerCommands = [
		...commandArray.matchAll(
			/defineAuthorCommand\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*\[([\s\S]*?)\]\s*\)/g,
		),
	].map((match) => {
		const argsSource = match[3];
		const args = [...argsSource.matchAll(/["']([^"']*)["']/g)].map(
			(argument) => argument[1],
		);
		const residue = argsSource
			.replace(/["'][^"']*["']/g, "")
			.replace(/[,\s]/g, "");
		if (residue.length > 0) {
			throw new Error(
				`runner command ${match[1]} has non-literal argv: ${residue}`,
			);
		}
		return {
			id: match[1],
			command: [match[2], ...args].join(" "),
		};
	});
	if (runnerCommands.length === 0) {
		throw new Error("runner ADAPTER_AUTHOR_COMMANDS contains no descriptors");
	}
	const executed = [
		...text.matchAll(/completedStep\(\s*["']([^"']+)["']/g),
		...text.matchAll(/runAuthorCommand\(\s*["']([^"']+)["']/g),
	].map((match) => match[1]);
	const structuralViolations = [];
	const runLoggedCallCount = [...text.matchAll(/\brunLogged\s*\(/g)].length;
	if (runLoggedCallCount !== 1) {
		structuralViolations.push(
			`runner has ${runLoggedCallCount} runLogged command call sites (expected the single descriptor-bound executor)`,
		);
	}
	if (
		!/return\s+runLogged\(\s*descriptor\.id,\s*resolveCommandExecutable\(descriptor\.executable\),\s*descriptor\.args,\s*options,?\s*\);/m.test(
			text,
		)
	) {
		structuralViolations.push(
			"runner command executor is not descriptor-bound for id, executable, and argv",
		);
	}
	return { runnerCommands, executed, structuralViolations };
}

function judge(args) {
	const violations = [...args.structuralViolations];
	const documentedIds = args.commands.map((entry) => entry.id);
	const commandIds = args.runnerCommands.map((entry) => entry.id);
	if (args.unpairedFenceCount > 0) {
		violations.push(
			`${args.unpairedFenceCount} executable guide block(s) have no adjacent opencut-command-id`,
		);
	}
	for (const [id, count] of repeated(documentedIds)) {
		violations.push(
			`guide command id ${id} occurs ${count} times (expected exactly 1)`,
		);
	}
	for (const [id, count] of repeated(commandIds)) {
		violations.push(
			`runner command id ${id} occurs ${count} times (expected exactly 1)`,
		);
	}
	for (const documented of args.commands) {
		const runner = args.runnerCommands.find(
			(entry) => entry.id === documented.id,
		);
		if (!runner) {
			violations.push(
				`documented command ${documented.id} has no author-runner command step`,
			);
			continue;
		}
		if (
			normalizeCommand(documented.command) !== normalizeCommand(runner.command)
		) {
			violations.push(
				`documented command ${documented.id} body ${JSON.stringify(normalizeCommand(documented.command))} does not match runner ${JSON.stringify(normalizeCommand(runner.command))}`,
			);
		}
	}
	for (const id of commandIds) {
		if (!documentedIds.includes(id)) {
			violations.push(`author-facing runner step ${id} is undocumented`);
		}
		const executionCount = args.executed.filter((entry) => entry === id).length;
		if (executionCount !== 1) {
			violations.push(
				`author-facing runner step ${id} has ${executionCount} execution sites (expected exactly 1)`,
			);
		}
	}
	return violations;
}

const guide = parseGuide(readFileSync(GUIDE_PATH, "utf8"));
const runnerSource = readFileSync(RUNNER_PATH, "utf8");
const runner = parseRunner(runnerSource);
const live = { ...guide, ...runner };

if (process.argv.includes("--negative-control")) {
	const proseOnly = judge({
		...live,
		commands: [
			...live.commands,
			{ id: "author/prose-only", command: "npm run imaginary" },
		],
	});
	if (!proseOnly.some((entry) => entry.includes("author/prose-only"))) {
		console.error(
			"negative control failed: unexecuted prose command stayed silent",
		);
		process.exit(1);
	}
	console.log(
		`FIRED unexecuted prose command: ${proseOnly.find((entry) => entry.includes("author/prose-only"))}`,
	);

	const bodyDrift = judge({
		...live,
		commands: live.commands.map((entry) =>
			entry.id === "author/conformance"
				? { ...entry, command: "npm run imaginary" }
				: entry,
		),
	});
	if (!bodyDrift.some((entry) => entry.includes("author/conformance body"))) {
		console.error(
			"negative control failed: existing-id command-body drift stayed silent",
		);
		process.exit(1);
	}
	console.log(
		`FIRED existing-id command-body drift: ${bodyDrift.find((entry) => entry.includes("author/conformance body"))}`,
	);

	const executionDriftSource = runnerSource.replace(
		"descriptor.args",
		'["run", "imaginary"]',
	);
	if (executionDriftSource === runnerSource) {
		console.error(
			"negative control failed: could not mutate the descriptor-bound argv",
		);
		process.exit(1);
	}
	const executionDrift = judge({
		...guide,
		...parseRunner(executionDriftSource),
	});
	if (!executionDrift.some((entry) => entry.includes("not descriptor-bound"))) {
		console.error(
			"negative control failed: actual execution argv drift stayed silent",
		);
		process.exit(1);
	}
	console.log(
		`FIRED actual execution argv drift: ${executionDrift.find((entry) => entry.includes("not descriptor-bound"))}`,
	);

	const undocumented = judge({
		...live,
		runnerCommands: [
			...live.runnerCommands,
			{ id: "author/undocumented", command: "npm run undocumented" },
		],
		executed: [...live.executed, "author/undocumented"],
	});
	if (!undocumented.some((entry) => entry.includes("author/undocumented"))) {
		console.error(
			"negative control failed: undocumented author step stayed silent",
		);
		process.exit(1);
	}
	console.log(
		`FIRED undocumented author-facing step: ${undocumented.find((entry) => entry.includes("author/undocumented"))}`,
	);
	console.log(
		"negative control: added-id, guide-body, execution-argv, and undocumented-step drift directions fired",
	);
	process.exit(0);
}

const violations = judge(live);
if (violations.length > 0) {
	for (const violation of violations) console.error(`FAIL ${violation}`);
	console.error(
		`check-adapter-author-guide-commands: ${violations.length} violation(s)`,
	);
	process.exit(1);
}
console.log(
	`check-adapter-author-guide-commands: PASS (${live.commands.length} executable guide commands = ${live.runnerCommands.length} descriptor-bound author-runner commands; command bodies and execution sites match exactly once)`,
);
