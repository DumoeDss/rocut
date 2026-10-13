import * as wasm from "opencut-wasm";
import type { AutomationApi } from "@opencut/editor-automation";
import { join } from "node:path";
import { readNativeExportFile } from "./native-export-readback";
import type { IncomingMessage } from "node:http";

export async function readReplacementRequest(request: IncomingMessage) {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += bytes.length;
		if (size > 4 * 1024 * 1024)
			throw Error("timeline-replacement-request-limit");
		chunks.push(bytes);
	}
	return JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
	);
}

const binding = () =>
	(
		wasm as unknown as {
			resolveTimelineReplacementBytes?: (input: Uint8Array) => string;
		}
	).resolveTimelineReplacementBytes;
export function timelineReplacementProbe() {
	return {
		schemaVersion: 1,
		protocol: 1,
		guardedCommit: typeof binding() === "function",
	};
}
/** Must be invoked inside HostPlane.enqueue, the same queue used by attachment PUT/DELETE. */
export async function readReplacementMedia(
	projectDirectory: string,
	assetId: string,
) {
	if (
		!/^[A-Za-z0-9][A-Za-z0-9._-]{0,499}$/.test(assetId) ||
		assetId === "." ||
		assetId === ".."
	)
		throw Error("timeline-replacement-media-id");
	const directory = join(projectDirectory, "attachments", assetId);
	const metadata = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(
			await readNativeExportFile(join(directory, "metadata.json"), 1024 * 1024),
		),
	);
	const bytes = await readNativeExportFile(
		join(directory, "body.bin"),
		1024 ** 3,
	);
	return { metadata, bytes };
}
export async function commitTimelineReplacement(args: {
	request: unknown;
	projectDirectory: string;
	automation: AutomationApi;
}) {
	const kernel = binding();
	if (!kernel) throw Error("timeline-replacement-kernel-unavailable");
	const request = args.request as {
		target?: { assetId?: string; byteLength?: number };
	};
	const key = request?.target?.assetId;
	// IO admission before attachment allocation; Rust is authoritative for all replacement rules.
	if (
		typeof key !== "string" ||
		!Number.isSafeInteger(request.target?.byteLength) ||
		request.target!.byteLength! <= 0 ||
		request.target!.byteLength! > 1024 ** 3
	)
		throw Error("timeline-replacement-media-limit");
	const attachment = await readReplacementMedia(args.projectDirectory, key);
	const [project, revision, assets, tracks, clips] = await Promise.all([
		args.automation.project(),
		args.automation.revision(),
		args.automation.assets(),
		args.automation.tracks(),
		args.automation.clips(),
	]);
	const header = Buffer.from(
		JSON.stringify({
			request: args.request,
			project,
			revision,
			assets,
			tracks,
			clips,
			mediaMetadata: attachment.metadata,
		}),
	);
	if (header.length > 4 * 1024 * 1024)
		throw Error("timeline-replacement-request-limit");
	const envelope = Buffer.alloc(
		4 + header.length + attachment.bytes.byteLength,
	);
	envelope.writeUInt32LE(header.length);
	header.copy(envelope, 4);
	attachment.bytes.copy(envelope, 4 + header.length);
	const admitted = JSON.parse(kernel(envelope));
	if (admitted.status !== "admitted")
		throw Error(admitted.error?.code ?? "timeline-replacement-rejected");
	const result = await args.automation.apply(admitted.batch);
	return {
		intentId: admitted.intentId,
		executionHash: admitted.executionHash,
		beforeRevision: admitted.beforeRevision,
		revision: result.revision,
	};
}
