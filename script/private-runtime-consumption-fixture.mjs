import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { packRuntime } from "./pack-runtime.mjs";
import { resolveRuntimeWasmPackage } from "./runtime-wasm-package-closure.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = (file) =>
	createHash("sha256").update(readFileSync(file)).digest("hex");
export async function privateRuntimeConsumptionFixture(
	wasmPackageDirectory,
	surfaceDirectory,
) {
	if (!isAbsolute(wasmPackageDirectory))
		throw Error("Private fixture requires absolute wasmPackageDirectory");
	const root = mkdtempSync("C:/tmps/rocut-private-runtime-consumption-");
	const outside = relative(repoRoot, root);
	if (
		!(isAbsolute(outside) || outside === ".." || outside.startsWith(`..${sep}`))
	)
		throw Error("Fixture must remain outside checkout");
	const canonical = join(repoRoot, "rust/wasm/pkg/opencut_wasm_bg.wasm"),
		canonicalBefore = hash(canonical);
	const options = {
		repoRoot,
		outDir: join(root, "runtime"),
		wasmPackageDirectory,
		...(surfaceDirectory === undefined ? {} : { surfaceDirectory }),
		skipSurface: true,
		determinism: false,
		smoke: false,
		allowDirty: true,
	};
	try {
		const selected = resolveRuntimeWasmPackage({
			repoRoot,
			wasmPackageDirectory,
		});
		const expected = {
			packageFiles: selected.files,
			binarySha256: hash(selected.wasmBinary),
			...(surfaceDirectory === undefined
				? {}
				: {
						surfaceCore: JSON.parse(
							readFileSync(
								join(surfaceDirectory, "surface-wasm-package.json"),
								"utf8",
							),
						).coreWasm,
					}),
			workers: [
				"liquid-object-worker-entry.mjs",
				"particle-sampler-worker-entry.mjs",
			].map((name) => ({
				name,
				sha256: hash(join(repoRoot, "apps/cli/src/programmatic", name)),
			})),
		};
		writeFileSync(
			join(root, "expected.json"),
			JSON.stringify(expected, null, 2),
			{ flag: "wx" },
		);
		const manifest = await packRuntime(options);
		writeFileSync(
			join(root, "pack-manifest.json"),
			JSON.stringify(manifest, null, 2),
			{ flag: "wx" },
		);
		copyFileSync(
			join(repoRoot, "script/consume-private-runtime.mjs"),
			join(root, "consume.mjs"),
		);
		const consume = spawnSync(
			process.execPath,
			[join(root, "consume.mjs"), root],
			{
				cwd: root,
				encoding: "utf8",
				timeout: 45000,
				maxBuffer: 4 * 1024 * 1024,
				windowsHide: true,
			},
		);
		if (consume.status !== 0)
			throw Error(
				`Plain Node private runtime consumption failed (${consume.status}): ${consume.stderr.slice(0, 2000)}`,
			);
		if (hash(canonical) !== canonicalBefore)
			throw Error("Canonical WASM changed during private fixture");
		writeFileSync(
			join(root, "fixture.json"),
			JSON.stringify(
				{
					status: "pass",
					scope: "private-runtime-consumption-not-P8-release",
					options,
					canonicalSha256Unchanged: canonicalBefore,
					consumption: JSON.parse(consume.stdout),
				},
				null,
				2,
			),
			{ flag: "wx" },
		);
		return { root, status: "pass" };
	} catch (error) {
		writeFileSync(
			join(root, "fixture-failure.json"),
			JSON.stringify(
				{
					status: "failed-without-gate-bypass",
					options,
					canonicalBefore,
					canonicalAfter: hash(canonical),
					error: String(error),
				},
				null,
				2,
			),
			{ flag: "wx" },
		);
		throw Error(`${error.message}\nRetained fixture: ${root}`, {
			cause: error,
		});
	}
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	console.log(
		JSON.stringify(
			await privateRuntimeConsumptionFixture(process.argv[2], process.argv[3]),
		),
	);
