import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
	ImageSequenceManifest,
	ProgrammaticResource,
} from "@opencut/editor-contracts";
import type { ProjectStore } from "@opencut/editor-ports";
import { InMemoryProjectStore } from "@opencut/editor-ports/in-memory";
import { imageSequencePng } from "../../../../script/fixtures/image-sequence-png";

export const digest = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
export function descriptor(
	id: string,
	bytes: Uint8Array,
	kind: "image" | "source" = "source",
): ProgrammaticResource {
	const sha256 = digest(bytes);
	return {
		id,
		kind,
		mimeType: kind === "image" ? "image/png" : "application/octet-stream",
		byteLength: bytes.byteLength,
		sha256,
		attachmentKey: `${kind === "source" ? "programmatic-source-sha256-" : "programmatic-sha256-"}${sha256}`,
	};
}

export async function imageSequenceFixture(frameCount = 3) {
	const parent = resolve(tmpdir());
	const directory = await mkdtemp(join(parent, "rocut-image-sequence-"));
	const rootDirectory = join(directory, "author");
	await mkdir(rootDirectory);
	const files = new Map<string, Uint8Array<ArrayBuffer>>();
	const add = (
		id: string,
		bytes: Uint8Array<ArrayBuffer>,
		kind: "image" | "source" = "source",
	) => {
		files.set(id, bytes);
		return descriptor(id, bytes, kind);
	};
	const frames = Array.from({ length: frameCount }, (_, index) =>
		add(
			`frames/${String(index).padStart(6, "0")}.png`,
			imageSequencePng(index),
			"image",
		),
	);
	const originalManifest = add(
		"provenance/render.json",
		new TextEncoder().encode('{"render":"original-author-manifest"}'),
	);
	const parts = [
		add("archive/project.part0", new Uint8Array([1, 2, 3])),
		add("archive/project.part1", new Uint8Array([4, 5])),
	];
	const manifest: ImageSequenceManifest = {
		version: 1,
		shotId: "shot-1",
		renderId: "render-1",
		frameRate: { numerator: 24000, denominator: 1001 },
		width: 2,
		height: 1,
		firstFileFrame: 1001,
		alpha: "straight",
		colorSpace: "srgb",
		frames,
		provenance: {
			engine: "blender",
			version: "4.5.0",
			entryFile: "project.blend",
			parameters: { samples: 16 },
			originalManifest,
			sourceFiles: [
				{
					path: "project.blend",
					byteLength: 5,
					sha256: digest(new Uint8Array([1, 2, 3, 4, 5])),
					parts,
				},
			],
		},
	};
	for (const [path, bytes] of files) {
		await mkdir(dirname(join(rootDirectory, path)), { recursive: true });
		await writeFile(join(rootDirectory, path), bytes);
	}
	const manifestPath = join(rootDirectory, "sequence.json");
	const writeManifest = async (value: unknown = manifest) =>
		writeFile(manifestPath, JSON.stringify(value), "utf8");
	await writeManifest();
	return {
		directory,
		rootDirectory,
		manifestPath,
		manifest,
		files,
		writeManifest,
		input: { id: "sequence/main", rootDirectory, manifestPath },
		cleanup: async () => {
			if (
				dirname(directory) !== parent ||
				!basename(directory).startsWith("rocut-image-sequence-")
			)
				throw Error("Unsafe image sequence fixture cleanup");
			await rm(directory, { recursive: true, force: true });
		},
	};
}

export class ObservedSequenceStore extends InMemoryProjectStore {
	readonly events: string[] = [];
	readonly saves: string[] = [];
	concurrentLoads = 0;
	maxConcurrentLoads = 0;
	failSaveKey: string | null = null;
	corruptReadbackKey: string | null = null;
	cancelAfterSave: AbortController | null = null;
	override async listAttachments(): Promise<never> {
		throw Error("Bulk body enumeration is forbidden");
	}
	override async loadAttachment(
		args: Parameters<ProjectStore["loadAttachment"]>[0],
	) {
		this.events.push(`load:${args.key}`);
		this.concurrentLoads++;
		this.maxConcurrentLoads = Math.max(
			this.maxConcurrentLoads,
			this.concurrentLoads,
		);
		try {
			const result = await super.loadAttachment(args);
			if (result && args.key === this.corruptReadbackKey)
				return { ...result, body: new Uint8Array([99]).buffer };
			return result;
		} finally {
			this.concurrentLoads--;
		}
	}
	override async saveAttachment(
		args: Parameters<ProjectStore["saveAttachment"]>[0],
	) {
		if (args.key === this.failSaveKey) throw Error("Fixture save failed");
		this.events.push(`save:${args.key}`);
		await super.saveAttachment(args);
		this.saves.push(args.key);
		this.cancelAfterSave?.abort(Error("Fixture cancelled import"));
	}
	override async removeAttachment(): Promise<never> {
		throw Error("Importer must not delete attachments");
	}
	override async remove(): Promise<never> {
		throw Error("Importer must not delete projects");
	}
	override async clear(): Promise<never> {
		throw Error("Importer must not clear shared storage");
	}
}
