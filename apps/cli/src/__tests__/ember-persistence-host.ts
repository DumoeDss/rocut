import { expect } from "bun:test";
import { join } from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import {
	EMBER_CLIPS,
	emberUpdate,
	type EmberSources,
} from "./ember-persistence-fixture";
import { EMBER_OVERFLOW_MARKER } from "./ember-persistence-invalid";

export function emberHost(root: string) {
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host: Awaited<ReturnType<typeof startHost>> | undefined;
	const currentHost = () => {
		if (!host) throw Error("Ember fixture Host is not running");
		return host;
	};
	const post = (
		route: string,
		body: unknown,
		overflowLiteral?: "1e400" | "-1e400",
	) => {
		let encoded = JSON.stringify(body);
		if (overflowLiteral) {
			const marker = JSON.stringify(EMBER_OVERFLOW_MARKER);
			if (encoded.split(marker).length !== 2)
				throw Error("Expected exactly one nonfinite wire marker");
			encoded = encoded.replace(marker, overflowLiteral);
		}
		return fetch(new URL(`api/${route}`, currentHost().editorUrl), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: encoded,
		});
	};
	const json = async <T>(route: string, body: unknown): Promise<T> => {
		const response = await post(route, body);
		if (!response.ok)
			throw Error(
				`Ember fixture ${route}: HTTP ${response.status}: ${(await response.text()).slice(0, 2000)}`,
			);
		return response.json() as Promise<T>;
	};
	const revision = async () =>
		Number(await currentHost().automation.revision());
	const current = async () => {
		const clips = await currentHost().automation.clips();
		expect(clips).toHaveLength(EMBER_CLIPS.length);
		const sources = Object.fromEntries(
			clips.map((clip) => [clip.id, clip.editing!.programmatic!]),
		);
		expect(Object.keys(sources).sort()).toEqual([...EMBER_CLIPS].sort());
		return sources;
	};
	const apply = async (
		expectedRevision: number,
		operations: readonly unknown[],
	) => {
		const result = await json<{ accepted: boolean; revision: number }>(
			"apply",
			{ expectedRevision, operations },
		);
		expect(result.accepted).toBe(true);
		expect(Number(result.revision)).toBe(expectedRevision + 1);
		expect(await revision()).toBe(expectedRevision + 1);
	};
	const reopen = async () => {
		await host?.close();
		host = undefined;
		host = await startHost(options);
	};
	const close = async () => {
		await host?.close();
		host = undefined;
	};
	const updates = (sources: EmberSources) =>
		EMBER_CLIPS.map((clipId) => emberUpdate(clipId, sources[clipId]));
	return {
		currentHost,
		post,
		json,
		revision,
		current,
		apply,
		reopen,
		close,
		updates,
	};
}
