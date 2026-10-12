import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rename,
	writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { CURRENT_PROJECT_VERSION } from "@opencut/editor-classic/transactions";
import { imageSequencePng } from "../../../../script/fixtures/image-sequence-png";
import { FileProjectStore } from "../file-store";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { loadProgrammaticResource } from "../programmatic/resources";

export const threeRevisionRoot = resolve(import.meta.dirname, "../../../..");
export const threeRevisionDigest = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex");
export const originalThreeEntry = `import {makeMesh} from './old-helper';
export function createScene({THREE,inputProps}) {
  const scene=new THREE.Scene();
  scene.name='THREE_ARCHIVE_INITIAL-'+inputProps.label;
  scene.add(makeMesh(THREE,inputProps));
  const camera=new THREE.PerspectiveCamera(45,1,0.1,100);camera.position.z=4;
  return {scene,camera};
}`;
export const originalThreeHelper = `export function makeMesh(THREE,props) {
  return new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:props.color}));
}`;
export const revisedThreeEntry = originalThreeEntry
	.replace("./old-helper", "./new-helper")
	.replace("THREE_ARCHIVE_INITIAL", "THREE_ARCHIVE_REVISED");
export const revisedThreeHelper = `export function makeMesh(THREE,props) {
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(0.6,8,6),new THREE.MeshBasicMaterial({color:props.color}));
  mesh.name='THREE_ARCHIVE_NEW_HELPER';mesh.scale.setScalar(props.scale);return mesh;
}`;

export interface ThreeRevisionBuildResult {
	source: ProgrammaticSource;
	reusedDocument: boolean;
}

export async function threeRevisionFixture(toolchainDirectory: string) {
	if (!isAbsolute(toolchainDirectory))
		throw Error("Explicit absolute toolchain required");
	const artifacts = join(
		threeRevisionRoot,
		".artifacts/three-archive-revision",
	);
	await mkdir(artifacts, { recursive: true });
	const previousAttempts = [];
	for (const entry of await readdir(artifacts, { withFileTypes: true })) {
		if (!entry.isDirectory() || !/^run-[A-Za-z0-9]+$/.test(entry.name))
			continue;
		const attemptRoot = join(artifacts, entry.name);
		if ((await realpath(attemptRoot)) !== resolve(attemptRoot))
			throw Error("Previous attempt must be an owned physical directory");
		const path = join(attemptRoot, "evidence.json");
		if (!existsSync(path)) continue;
		const bytes = await readFile(path);
		const receipt = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		);
		if (resolve(receipt.artifacts) !== resolve(attemptRoot))
			throw Error("Previous receipt does not identify its owned run");
		previousAttempts.push({
			path,
			sha256: threeRevisionDigest(bytes),
			ok: receipt.ok,
			sourceHead: receipt.sourceHead,
			error: receipt.error?.message,
		});
	}
	previousAttempts.sort((a, b) => a.path.localeCompare(b.path));
	const root = await mkdtemp(join(artifacts, "run-"));
	const author = join(root, "author");
	await mkdir(author);
	await writeFile(join(author, "main.ts"), originalThreeEntry, { flag: "wx" });
	await writeFile(join(author, "old-helper.ts"), originalThreeHelper, {
		flag: "wx",
	});
	await writeFile(join(author, "pixel.png"), imageSequencePng(0), {
		flag: "wx",
	});
	const projectRoot = join(root, "project");
	const options = {
		projectRoot,
		registry: new TargetRegistry(join(root, "registry")),
		engineToolchainDirectory: toolchainDirectory,
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host = await startHost(options);
	const store = new FileProjectStore({
		root: projectRoot,
		schemaVersion: CURRENT_PROJECT_VERSION,
	});
	const context = { store, projectId: host.automation.projectId };
	const post = (action: string, input: unknown) =>
		fetch(new URL(`api/programmatic/build/${action}`, host.editorUrl), {
			method: "POST",
			body: JSON.stringify(input),
		});
	const success = async (
		action: string,
		input: unknown,
	): Promise<ThreeRevisionBuildResult> => {
		const response = await post(action, input);
		const value = await response.json();
		if (!response.ok)
			throw Error(
				`Build ${action}: ${response.status} ${JSON.stringify(value)}`,
			);
		return value;
	};
	const request = async (route: string, input?: unknown) => {
		const response = await fetch(new URL(`api/${route}`, host.editorUrl), {
			...(input === undefined
				? {}
				: { method: "POST", body: JSON.stringify(input) }),
		});
		const value = await response.json();
		if (!response.ok)
			throw Error(`Host ${route}: ${response.status} ${JSON.stringify(value)}`);
		return value;
	};
	// Host queries are identity collections, not an ordering contract. Match the
	// established glass-editor Host probe while project.json remains byte-exact.
	const byId = <T extends { id: string }>(items: readonly T[]) =>
		[...items].sort((a, b) => a.id.localeCompare(b.id));
	const snapshot = async () => ({
		project: await host.automation.project(),
		clips: byId(await host.automation.clips()),
		tracks: byId(await host.automation.tracks()),
		revision: await host.automation.revision(),
	});
	const recordBytes = () => readFile(join(projectRoot, "project.json"));
	const ledger = async () => {
		const headers = await store.listAttachmentHeaders({
			projectId: context.projectId,
		});
		return Promise.all(
			[...headers]
				.sort((a, b) => a.key.localeCompare(b.key))
				.map(async (header) => {
					const attachment = await store.loadAttachment({
						projectId: context.projectId,
						key: header.key,
					});
					if (!attachment)
						throw Error(`Missing persisted attachment: ${header.key}`);
					return {
						header,
						bodySha256: threeRevisionDigest(new Uint8Array(attachment.body)),
					};
				}),
		);
	};
	const resources = async (source: ProgrammaticSource) => {
		if (!source.build) throw Error("Missing Three build archive");
		const descriptors = [
			...source.build.inputs,
			source.build.toolchainLock,
			...(source.resources ?? []),
		];
		return Promise.all(
			descriptors.map(async (resource) => {
				const resolved = await loadProgrammaticResource({
					...context,
					resource,
				});
				return {
					...resource,
					actualSha256: threeRevisionDigest(new Uint8Array(resolved.body)),
				};
			}),
		);
	};
	return {
		root,
		previousAttempts,
		author,
		context,
		post,
		success,
		request,
		snapshot,
		recordBytes,
		ledger,
		resources,
		spec: {
			version: 1,
			engine: "three",
			sourceDirectory: author,
			entryFile: "main.ts",
			files: ["main.ts", "old-helper.ts", "pixel.png"],
			width: 64,
			height: 64,
			frameRate: { numerator: 30, denominator: 1 },
			durationFrames: 60,
			seed: 7,
			inputProps: { label: "initial-prop", color: 0x204080, scale: 1 },
		},
		moveAuthor: async () => {
			const target = join(root, "author-unavailable");
			if (
				relative(root, author) !== "author" ||
				relative(root, target) !== "author-unavailable" ||
				existsSync(target)
			)
				throw Error("Unsafe owned author move");
			await rename(author, target);
			if (existsSync(author)) throw Error("Author remains available");
			return target;
		},
		reopen: async () => {
			await host.close();
			host = await startHost(options);
		},
		close: () => host.close(),
		writeEvidence: async (value: unknown) => {
			const bytes = JSON.stringify(value, null, 2) + "\n";
			await writeFile(join(root, "evidence.json"), bytes, "utf8");
			const receipt = process.env.ROCUT_THREE_REVISION_RECEIPT;
			if (receipt) {
				const expected = join(
					threeRevisionRoot,
					"docs/evidence/three-archive-revision-20261011.json",
				);
				if (
					resolve(receipt) !== expected ||
					relative(threeRevisionRoot, expected).startsWith(`..${sep}`)
				)
					throw Error(
						"Receipt must be the exclusively owned private evidence file",
					);
				await writeFile(expected, bytes, "utf8");
			}
		},
	};
}
