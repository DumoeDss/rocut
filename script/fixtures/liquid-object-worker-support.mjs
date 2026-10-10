import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const cli = process.env.LIQUID_TRANSPORT_NATIVE_CLI;
const esbuildPath = process.env.LIQUID_ESBUILD_MODULE;
if (!cli || !esbuildPath)
	throw Error("Actual native Rust CLI and existing esbuild required");
const esbuild = await import(pathToFileURL(esbuildPath).href);
async function load(relative) {
	const entry = fileURLToPath(new URL(relative, import.meta.url));
	const result = await esbuild.build({
		entryPoints: [entry],
		bundle: true,
		write: false,
		platform: "node",
		format: "esm",
		logLevel: "silent",
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
	);
}
const { spawnLiquidObjectProcess } = await load(
	"../../apps/cli/src/programmatic/liquid-object-worker-process.ts",
);
const { bootstrapLiquidObjectProcess } = await load(
	"../../apps/cli/src/programmatic/liquid-object-worker-bootstrap.ts",
);
const { createThreeLiquidObjectTransport } = await load(
	"../../apps/cli/src/programmatic/engines/three-liquid-object-transport.ts",
);
const { captureLiquidObjectWorkerSource } = await load(
	"../../apps/cli/src/programmatic/liquid-object-worker-source.ts",
);
const workerEntrySource = readFileSync(
	new URL(
		"../../apps/cli/src/programmatic/liquid-object-worker-entry.mjs",
		import.meta.url,
	),
	"utf8",
);
const policyJson = execFileSync(cli, ["policy"], {
	encoding: "utf8",
	windowsHide: true,
}).trim();
const frame = {
	sessionId: "actual-native-fixed-worker",
	index: 8,
	time: 1.5,
	seed: 31,
};
const frameJson = JSON.stringify(frame);
const nativeClientUrl = new URL(
	"./liquid-object-transport-native-client.mjs",
	import.meta.url,
).href;
// Test-only native adapter: the Rust admission is actual persistent native Rust,
// not a WASM-owner runtime claim. Only the internal spawn seam sees this module.
function nativeModule({ loop = false } = {}) {
	return `import {execFileSync} from 'node:child_process';
import {nativeAdmission} from ${JSON.stringify(nativeClientUrl)};
const cli=${JSON.stringify(cli)};
export function liquidObjectTransportPolicyJson(){if(Object.keys(process.env).some(k=>['NODE_OPTIONS','BUN_OPTIONS'].includes(k.toUpperCase())))throw Error('unscrubbed');return execFileSync(cli,['policy'],{encoding:'utf8',windowsHide:true}).trim();}
export class LiquidObjectTransportOwner{constructor(json){this.channel=nativeAdmission(cli,JSON.parse(json));}async command(json){return (await this.channel).command(json);}}
export function evaluateLiquidObjectFrameJson(json){${loop ? "while(true){}" : "return execFileSync(cli,['evaluate'],{input:json,encoding:'utf8',windowsHide:true}).trim();"}}
`;
}
async function fixture({ source = nativeModule(), timeout = 5000 } = {}) {
	const controller = new AbortController();
	const spawned = spawnLiquidObjectProcess({
		workerEntrySource,
		moduleUrl: `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`,
	});
	let closed = false;
	spawned.child.once("close", () => {
		closed = true;
	});
	const worker = await bootstrapLiquidObjectProcess({
		spawned,
		frameJson,
		bootstrapTimeoutMs: timeout,
		signal: controller.signal,
	});
	const transport = createThreeLiquidObjectTransport({
		frameJson,
		policyJson: worker.policyJson,
		admission: worker.admission,
		evaluate: worker.evaluate,
		signal: controller.signal,
	});
	return {
		spawned,
		worker,
		transport,
		controller,
		get closed() {
			return closed;
		},
	};
}
const request = () =>
	JSON.stringify({
		version: 1,
		params: { version: 1 },
		positions: [-1, 0, 0, 1, 0, 0, 0, 1, 0],
		time: frame.time,
		seed: frame.seed,
	});

export {
	fixture,
	request,
	nativeModule,
	policyJson,
	frame,
	frameJson,
	workerEntrySource,
	spawnLiquidObjectProcess,
	bootstrapLiquidObjectProcess,
	captureLiquidObjectWorkerSource,
};
