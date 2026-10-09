import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { digest } from "./hyperframes-variable-rate-io";

const ENGINE_INTEGRITY =
	"sha512-Tfl0SlYbru9IFdAL9iGRU8hmx1jrfW2LxFyf5sjnMJzybbGuULfg+ffAwAsT/wiXBHFrzoQumQV+F12TfXUE+Q==";
const MIXER_SHA256 =
	"bbe78eb851b4e5d6d2e94b0f6ec84b5de26b2fe5218cbe348d9e9cd89320ae78";
interface AstNode {
	type: string;
	start: number;
	end: number;
	name?: string;
	value?: number | AstNode;
	id?: AstNode;
	key?: AstNode;
	init?: AstNode;
	declaration?: AstNode;
	declarations?: AstNode[];
	properties?: AstNode[];
}
interface Parser {
	parse(
		code: string,
		options: { ecmaVersion: "latest"; sourceType: "module" },
	): { body: AstNode[] };
}

/** Preserve complete native declarations in original order; never rewrite DSP. */
function declarations(code: string, names: string[], acorn: Parser) {
	const tree = acorn.parse(code, {
		ecmaVersion: "latest",
		sourceType: "module",
	});
	const wanted = new Set(names),
		records: {
			name: string;
			from: number;
			to: number;
			sha256: string;
			code: string;
		}[] = [];
	for (const top of tree.body) {
		const node = top.type === "ExportNamedDeclaration" ? top.declaration : top;
		if (!node) continue;
		const identifiers =
			node.type === "FunctionDeclaration"
				? [node.id?.name]
				: node.type === "VariableDeclaration"
					? (node.declarations ?? []).map((item) => item.id?.name)
					: [];
		const selected = identifiers.filter(
			(name): name is string => name !== undefined && wanted.has(name),
		);
		if (!selected.length) continue;
		assert.equal(
			identifiers.length,
			1,
			"Expected a complete single native declaration",
		);
		const text = code.slice(node.start, node.end);
		records.push({
			name: selected[0],
			from: node.start,
			to: node.end,
			sha256: digest(text),
			code: text,
		});
		wanted.delete(selected[0]);
	}
	assert.deepEqual([...wanted], [], "Missing native preparation declaration");
	return records;
}

export async function nativePreparationSource(
	toolchain: string,
	archive: string,
) {
	const packed = await readFile(archive);
	assert.equal(
		"sha512-" + createHash("sha512").update(packed).digest("base64"),
		ENGINE_INTEGRITY,
	);
	const archiveText = (path: string) =>
		new TextDecoder("utf8", { fatal: true }).decode(
			execFileSync("tar", ["-xOf", archive, path], {
				windowsHide: true,
				maxBuffer: 4 * 1024 * 1024,
			}),
		);
	const engine = JSON.parse(archiveText("package/package.json"));
	assert.equal(engine.name, "@hyperframes/engine");
	assert.equal(engine.version, "0.8.139");
	const acornRoot = join(toolchain, "node_modules/acorn");
	assert.equal(
		JSON.parse(await readFile(join(acornRoot, "package.json"), "utf8")).version,
		"8.19.0",
	);
	const acorn: Parser = await import(
		pathToFileURL(join(acornRoot, "dist/acorn.mjs")).href
	);
	const mixer = archiveText("package/dist/services/audioMixer.js");
	assert.equal(digest(mixer), MIXER_SHA256);
	const parts = declarations(
		mixer,
		[
			"formatFilterNumber",
			"buildAtempoFilter",
			"RAMP_SLICE_SECONDS",
			"MAX_RAMP_SLICES",
			"buildRampFilterComplex",
			"preparedAudioOutputArgs",
			"STEREO_CHANNEL_FILTER",
			"stereoOutputArgs",
			"boundedDetail",
			"ffmpegFailure",
			"prepareAudioTrack",
			"extractAudioFromVideo",
		],
		acorn,
	);
	const runnerSource = archiveText("package/dist/utils/runFfmpeg.js");
	const errors = declarations(
		runnerSource,
		[
			"DEFAULT_STDERR_TAIL_LINES",
			"formatWindowsFfmpegExit",
			"formatFfmpegError",
		],
		acorn,
	);
	const configSource = archiveText("package/dist/config.js");
	const configTree = acorn.parse(configSource, {
		ecmaVersion: "latest",
		sourceType: "module",
	});
	const defaults = configTree.body
		.flatMap((node) => node.declaration?.declarations ?? [])
		.find((node) => node.id?.name === "DEFAULT_CONFIG");
	const timeout = defaults?.init?.properties?.find(
		(property) => property.key?.name === "ffmpegProcessTimeout",
	);
	assert.ok(timeout && typeof timeout.value === "object");
	assert.equal(timeout.value.type, "Literal");
	assert.equal(timeout.value.value, 300000);
	const timeoutCode = configSource.slice(timeout.start, timeout.end);
	const code = `const DEFAULT_CONFIG={${timeoutCode}};\n${errors.map((item) => item.code).join("\n")}\n${parts.map((item) => item.code).join("\n")}\nreturn {prepareAudioTrack,extractAudioFromVideo,buildRampFilterComplex,buildAtempoFilter,preparedAudioOutputArgs};`;
	return {
		code,
		provenance: {
			engineVersion: engine.version,
			parserVersion: "8.19.0",
			engineIntegrity: ENGINE_INTEGRITY,
			mixerSha256: digest(mixer),
			runnerSha256: digest(runnerSource),
			configSha256: digest(configSource),
			extractedSha256: digest(code),
			timeoutCode,
			declarations: [...errors, ...parts].map(({ code: _, ...item }) => item),
		},
	};
}
