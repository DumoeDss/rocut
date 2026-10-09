import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { launchFrameBrowser } from "./chromium-process";
import {
	parseRemotionInspection,
	admitInspectedCompositions,
	inspectionRevision,
} from "./remotion-inspection-snapshot";
import type {
	InspectedComposition,
	RemotionInspectionSnapshot,
} from "./remotion-inspection-types";
import { snapshotSourceFiles } from "./engines/source-snapshot";
import { loadEngineToolchain } from "./engines/toolchain";
import { withBuildResources } from "./engines/build-source";
import { runCompilerChild } from "./engines/compiler-process";
import { REMOTION_COMPILER_CHILD } from "./engines/remotion-compiler-child";
import { REMOTION_ENVIRONMENT } from "./engines/remotion-driver";
import { REMOTION_MEDIA_WRAPPER } from "./engines/remotion-media";
import {
	REMOTION_INSPECTION_DRIVER,
	remotionInspectionExpression,
} from "./remotion-inspection-driver";

export async function inspectRemotionProject({
	input,
	toolchainDirectory,
	executable,
	signal,
	prepared,
}: {
	input: unknown;
	toolchainDirectory: string;
	executable: string;
	signal: AbortSignal;
	prepared?: RemotionInspectionSnapshot;
}): Promise<RemotionInspectionSnapshot> {
	const parsed = prepared
		? { source: prepared.source, sourceDirectory: "", frameRates: undefined }
		: parseRemotionInspection(input);
	const toolchain = await loadEngineToolchain(
		toolchainDirectory,
		"remotion",
		signal,
	);
	if (
		prepared &&
		prepared.toolchainLockSha256 !== toolchain.lock.resource.sha256
	)
		throw Error("Inspected toolchain changed; inspect again");
	const inputs =
		prepared?.inputs ??
		(await snapshotSourceFiles(parsed.sourceDirectory, parsed.source, signal));
	const source = withBuildResources(
		parsed.source,
		inputs.map((i) => i.resource),
		toolchain.lock.resource,
	);
	const parent = resolve(tmpdir()),
		staging = await mkdtemp(join(parent, "rocut-remotion-inspect-"));
	try {
		const project = join(staging, "project"),
			outputFile = join(staging, "inspection.html");
		await mkdir(project);
		for (const item of inputs) {
			signal.throwIfAborted();
			const path = join(project, item.resource.id);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, new Uint8Array(item.body), { flag: "wx" });
		}
		await runCompilerChild(
			{
				engine: "remotion",
				project,
				outputFile,
				files: inputs.map((i) => i.resource.id),
				entryFile: source.build!.entryFile,
				compilerEntry: toolchain.compilerEntry,
				toolchainRoot: toolchain.root,
				width: source.width,
				height: source.height,
				frameRate: source.frameRate,
				durationFrames: source.durationFrames,
				driver: REMOTION_INSPECTION_DRIVER,
				environment: REMOTION_ENVIRONMENT,
				mediaWrapper: REMOTION_MEDIA_WRAPPER,
				spec: { inputProps: source.build!.inputProps },
				nativeAudio: false,
			},
			signal,
			REMOTION_COMPILER_CHILD,
		);
		const code = new TextDecoder("utf-8", { fatal: true }).decode(
			await readFile(outputFile),
		);
		const browser = await launchFrameBrowser(executable, signal);
		let compositions: InspectedComposition[];
		try {
			const target = await browser.send("Target.createTarget", {
				url: "about:blank",
			});
			const attached = await browser.send("Target.attachToTarget", {
				targetId: target.targetId,
				flatten: true,
			});
			if (typeof attached.sessionId !== "string")
				throw Error("No inspection browser session");
			const send = (method: string, params = {}) =>
				browser.send(method, params, attached.sessionId as string);
			await send("Network.enable");
			await send("Network.setBlockedURLs", {
				urls: [
					"http://*",
					"https://*",
					"file://*",
					"ftp://*",
					"ws://*",
					"wss://*",
				],
			});
			await send("Runtime.enable");
			const reply = await send("Runtime.evaluate", {
				expression: remotionInspectionExpression(code),
				awaitPromise: true,
				returnByValue: true,
				timeout: 15000,
			});
			if (reply.exceptionDetails)
				throw Error(
					`Remotion inspection failed: ${JSON.stringify(reply.exceptionDetails).slice(0, 2000)}`,
				);
			compositions = JSON.parse(
				JSON.stringify((reply.result as { value?: unknown })?.value),
			);
			if (!Array.isArray(compositions) || !compositions.length)
				throw Error("Expected inspected compositions");
		} finally {
			await browser.close();
		}
		const snapshot = {
			revision: "",
			source,
			inputs,
			toolchainLockSha256: toolchain.lock.resource.sha256!,
			compositions,
		};
		admitInspectedCompositions(snapshot, parsed.frameRates);
		snapshot.revision = inspectionRevision(snapshot);
		signal.throwIfAborted();
		return snapshot;
	} finally {
		if (
			dirname(staging) !== parent ||
			!basename(staging).startsWith("rocut-remotion-inspect-")
		)
			throw Error("Unsafe inspection cleanup");
		await rm(staging, { recursive: true, force: true });
	}
}
