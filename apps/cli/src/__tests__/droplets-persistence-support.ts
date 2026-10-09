import { expect } from "bun:test";
import {
	revisionOf,
	type ProgrammaticResource,
} from "@opencut/editor-contracts";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { startHost, type RunningHost } from "../host";
import { TargetRegistry } from "../target-registry";

const digest = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const byId = <T extends { id: string }>(items: readonly T[]) =>
	[...items].sort((a, b) => a.id.localeCompare(b.id));

export async function withDropletsHost(
	run: (fixture: DropletsPersistenceFixture) => Promise<void>,
) {
	const allowed = resolve("C:/tmps");
	const parent = resolve(process.env.ROCUT_PROBE_ARTIFACT_ROOT ?? allowed);
	const descendant = relative(allowed, parent);
	if (descendant.startsWith("..") || isAbsolute(descendant))
		throw new Error("Droplets persistence artifacts must stay under C:/tmps");
	await mkdir(parent, { recursive: true });
	const root = await mkdtemp(join(parent, "droplets-persistence-"));
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host: RunningHost | undefined;
	let revision = 0;
	const evidence = {
		ok: false,
		transport: "real Host api/apply and FileProjectStore project.json",
		renderingTested: false,
		editorHistoryTested: false,
		attachedOpticalChannels: ["amount", "refraction", "highlight"],
		layerAnimationsSupported: false,
		reopens: [] as { label: string; revision: number; projectSha256: string }[],
		rejected: [] as string[],
		hostClosed: false,
	};
	const current = () => {
		if (!host) throw new Error("Droplets fixture Host is not running");
		return host;
	};
	const post = (route: string, body: unknown) =>
		fetch(new URL(`api/${route}`, current().editorUrl), {
			method: "POST",
			body: JSON.stringify(body),
		});
	const snapshot = async () => ({
		clips: byId(await current().automation.clips()),
		tracks: byId(await current().automation.tracks()),
		revision: await current().automation.revision(),
	});
	const disk = () => readFile(join(options.projectRoot, "project.json"));
	const imageBytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM6kAAAAASUVORK5CYII=",
		"base64",
	);
	try {
		host = await startHost(options);
		await run({
			snapshot,
			async catalog() {
				const response = await fetch(
					new URL("api/editing/catalog", current().editorUrl),
				);
				expect(response.status).toBe(200);
				return response.json();
			},
			async importImage() {
				const author = join(root, "author");
				await mkdir(author);
				const filePath = join(author, "droplets.png");
				await writeFile(filePath, imageBytes, { flag: "wx" });
				const response = await post("programmatic/resources/import", {
					id: "droplets.png",
					filePath,
					kind: "image",
					mimeType: "image/png",
				});
				expect(response.status).toBe(200);
				const { resource } = await response.json();
				expect(resource.sha256).toBe(digest(imageBytes));
				expect(resource.byteLength).toBe(imageBytes.length);
				expect(await current().automation.revision()).toBe(revisionOf(0));
				return resource;
			},
			async makeAuthorUnavailable() {
				await rename(join(root, "author"), join(root, "unavailable-author"));
			},
			async assertResource(resource) {
				const response = await post("programmatic/resources/load", resource);
				expect(response.status).toBe(200);
				const bytes = Buffer.from(await response.arrayBuffer());
				expect(bytes).toEqual(imageBytes);
				expect(digest(bytes)).toBe(resource.sha256);
			},
			async accept(operations) {
				const response = await post("apply", {
					expectedRevision: revision,
					operations,
				});
				await response.json();
				expect(response.status).toBe(200);
				expect(await current().automation.revision()).toBe(
					revisionOf(++revision),
				);
			},
			async reject(clipId, editing, label, issue) {
				const before = await snapshot(),
					persisted = await disk();
				const response = await post("apply", {
					expectedRevision: revision,
					operations: [
						{
							kind: "update-clip",
							clipId: "sentinel",
							patch: {
								editing: {
									type: "text",
									name: "Must roll back",
									params: { content: "Changed" },
								},
							},
						},
						{ kind: "update-clip", clipId, patch: { editing } },
					],
				});
				const details = JSON.stringify(await response.json());
				expect(response.status, label).toBe(409);
				if (issue) expect(details.includes(issue), label).toBe(true);
				expect(await snapshot(), label).toEqual(before);
				expect(await current().automation.revision(), label).toBe(
					revisionOf(revision),
				);
				expect(await disk(), label).toEqual(persisted);
				evidence.rejected.push(label);
			},
			async reopen(label) {
				const before = await snapshot(),
					persisted = await disk();
				expect(JSON.parse(persisted.toString("utf8")).wrapperVersion).toBe(1);
				await current().close();
				host = undefined;
				host = await startHost(options);
				expect(await snapshot(), label).toEqual(before);
				expect(await disk(), label).toEqual(persisted);
				evidence.reopens.push({
					label,
					revision,
					projectSha256: digest(persisted),
				});
			},
		});
		evidence.ok = true;
	} finally {
		try {
			await host?.close();
			evidence.hostClosed = true;
		} finally {
			await writeFile(
				join(root, "evidence.json"),
				`${JSON.stringify(evidence, null, 2)}\n`,
				{ encoding: "utf8", flag: "wx" },
			);
			console.log(
				JSON.stringify({
					dropletsPersistenceArtifacts: root,
					ok: evidence.ok,
					hostClosed: evidence.hostClosed,
					reopens: evidence.reopens.length,
					rejected: evidence.rejected.length,
				}),
			);
		}
	}
}

type HostSnapshot = {
	clips: Awaited<ReturnType<RunningHost["automation"]["clips"]>>;
	tracks: Awaited<ReturnType<RunningHost["automation"]["tracks"]>>;
	revision: Awaited<ReturnType<RunningHost["automation"]["revision"]>>;
};

interface DropletsPersistenceFixture {
	snapshot(): Promise<HostSnapshot>;
	catalog(): Promise<{
		effects: Record<string, { key: string; keyframable: boolean }[]>;
	}>;
	importImage(): Promise<ProgrammaticResource>;
	makeAuthorUnavailable(): Promise<void>;
	assertResource(resource: ProgrammaticResource): Promise<void>;
	accept(operations: unknown[]): Promise<void>;
	reject(
		clipId: string,
		editing: unknown,
		label: string,
		issue?: string,
	): Promise<void>;
	reopen(label: string): Promise<void>;
}
