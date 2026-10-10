import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	blazeHostAtomicBatch,
	type BlazeHostInvalid,
} from "./blaze-host-cases";
import {
	blazeHostFields,
	blazeHostSentinel,
	type BlazeHostClip,
} from "./blaze-host-contract";
import { blazeHostDigest } from "./blaze-host-source";

export type BlazeHostContext = { revision: number; project: { id: string } };
export type BlazeHostSnapshot = {
	clips: BlazeHostClip[];
	tracks: { id: string; [key: string]: unknown }[];
	revision: number;
};

export function assertBlazeHostCatalog(catalog: {
	effects: Record<string, Record<string, unknown>[]>;
}) {
	assert(Array.isArray(catalog.effects.blaze), "Current Host lacks Blaze");
	const fields = catalog.effects.blaze.map((field) => ({
		key: field.key,
		type: field.type,
		min: field.min,
		max: field.max,
		step: field.step,
		default: field.default,
		keyframable: field.keyframable,
	}));
	assert.deepEqual(
		fields,
		blazeHostFields.map(([key, min, max, step, value, keyframable]) => ({
			key,
			type: "number",
			min,
			max,
			step,
			default: value,
			keyframable,
		})),
	);
	return fields;
}

export function assertBlazeHostAuthored({
	snapshot,
	clips,
}: {
	snapshot: BlazeHostSnapshot;
	clips: readonly BlazeHostClip[];
}) {
	assert.equal(snapshot.clips.length, clips.length);
	for (const expected of clips) {
		const actual = snapshot.clips.find((clip) => clip.id === expected.id);
		assert(actual, `Missing clip ${expected.id}`);
		for (const key of Object.keys(expected) as (keyof BlazeHostClip)[])
			assert.deepEqual(actual[key], expected[key], `${expected.id}.${key}`);
	}
}

export function blazeHostClient({
	editorUrl,
	projectRoot,
}: {
	editorUrl: () => string;
	projectRoot: string;
}) {
	const raw = (route: string, body?: unknown) =>
		fetch(new URL(`api/${route}`, editorUrl()), {
			signal: AbortSignal.timeout(15000),
			...(body === undefined
				? {}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}),
		});
	const request = async <T>(route: string, body?: unknown): Promise<T> => {
		const response = await raw(route, body);
		const result = await response.json();
		assert.equal(response.status, 200, JSON.stringify(result));
		return result as T;
	};
	const context = () => request<BlazeHostContext>("context");
	const snapshot = async (): Promise<BlazeHostSnapshot> => {
		const current = await context();
		const clips = await request<BlazeHostSnapshot["clips"]>("clips");
		const tracks = await request<BlazeHostSnapshot["tracks"]>("tracks");
		const byId = (a: { id: string }, b: { id: string }) =>
			a.id.localeCompare(b.id);
		return {
			clips: clips.sort(byId),
			tracks: tracks.sort(byId),
			revision: current.revision,
		};
	};
	const disk = () => readFile(join(projectRoot, "project.json"));
	const accept = async (operations: unknown[]) => {
		const before = await context();
		const result = await request<{ accepted: boolean; revision: number }>(
			"apply",
			{
				expectedRevision: before.revision,
				operations,
			},
		);
		assert.equal(result.accepted, true);
		assert.equal((await context()).revision, before.revision + 1);
		return result;
	};
	const reject = async (invalid: BlazeHostInvalid) => {
		const before = await snapshot(),
			bytes = await disk();
		const sentinel = before.clips.find((clip) => clip.id === blazeHostSentinel);
		assert(sentinel);
		const response = await raw("apply", {
			expectedRevision: before.revision,
			operations: blazeHostAtomicBatch({ invalid, sentinel }),
		});
		const result = await response.json();
		const after = await snapshot(),
			afterBytes = await disk();
		const diagnostic = {
			label: invalid.label,
			expectedIssue: invalid.issue,
			status: response.status,
			response: result,
			before: {
				revision: before.revision,
				projectSha256: blazeHostDigest(bytes),
				snapshotSha256: blazeHostDigest(JSON.stringify(before)),
			},
			after: {
				revision: after.revision,
				projectSha256: blazeHostDigest(afterBytes),
				snapshotSha256: blazeHostDigest(JSON.stringify(after)),
			},
			memoryUnchanged: isDeepStrictEqual(after, before),
			persistedBytesUnchanged: afterBytes.equals(bytes),
		};
		const diagnosticFile = `rejection-${blazeHostDigest(invalid.label).slice(0, 20)}.json`;
		await writeFile(
			join(projectRoot, "..", diagnosticFile),
			JSON.stringify(diagnostic, null, 2) + "\n",
			{
				encoding: "utf8",
				flag: "wx",
			},
		);
		assert.equal(response.status, 409, invalid.label);
		assert.equal(result.accepted, false, invalid.label);
		assert.deepEqual(after, before, `${invalid.label}: memory changed`);
		assert.deepEqual(
			afterBytes,
			bytes,
			`${invalid.label}: persisted bytes changed`,
		);
		assert(
			JSON.stringify(result).includes(invalid.issue),
			`${invalid.label}: ${JSON.stringify(result)}`,
		);
		return {
			label: invalid.label,
			status: response.status,
			message: result.message,
			revision: before.revision,
			projectSha256: blazeHostDigest(bytes),
			sentinelSha256: blazeHostDigest(JSON.stringify(sentinel)),
			allClipsUnchanged: true,
			diagnosticFile,
		};
	};
	return { raw, request, context, snapshot, disk, accept, reject };
}
