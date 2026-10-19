import type {
	CreatorWorkspaceBridge,
	CreatorWorkspaceCommand,
	CreatorWorkspaceSnapshot,
} from "@opencut/editor-classic/surface";
import {
	assembleWorkspacePages,
	isWorkspacePage,
} from "./creator-workspace-pages";

export interface ConnectedCreatorWorkspaceBridge extends CreatorWorkspaceBridge {
	dispose(): void;
}

/** Mirrors the Host's fixed-placement budget shape; this grants no execution authority. */
function fixedNativePlacement(command?: CreatorWorkspaceCommand): boolean {
	if (command?.type !== "asset.place-version") return false;
	const text = (value: unknown) =>
		typeof value === "string" && value.length > 0 && value.length <= 500;
	const natural = (value: unknown) =>
		Number.isSafeInteger(value) && Number(value) >= 0;
	const native = command.native;
	const placement = native?.placement;
	return Boolean(
		text(command.assetId) &&
		text(command.versionId) &&
		native &&
		!Array.isArray(native) &&
		text(native.projectId) &&
		text(native.sceneId) &&
		natural(native.revision) &&
		placement &&
		!Array.isArray(placement) &&
		text(placement.clipId) &&
		text(placement.trackId) &&
		natural(placement.startTime) &&
		natural(placement.trimStart) &&
		natural(placement.trimEnd) &&
		(placement.duration === undefined || natural(placement.duration)) &&
		(command.expectedSha256 === undefined ||
			(typeof command.expectedSha256 === "string" &&
				/^[a-f0-9]{64}$/.test(command.expectedSha256))),
	);
}

/** Discover an optional parent port. Old hosts simply retain the native editor. */
export async function connectCreatorWorkspaceBridge({
	target = window,
	signal,
	// The Host may spend its full 30s snapshot callback budget on cold reads.
	// Discovery needs bounded delivery margin before falling back to native UI.
	timeoutMs = 35000,
}: {
	target?: Window;
	signal?: AbortSignal;
	timeoutMs?: number;
} = {}): Promise<ConnectedCreatorWorkspaceBridge | null> {
	if (target.parent === target || signal?.aborted) return null;
	let origin: string | null = null;
	let disposed = false;
	let sequence = 0;
	let latest: CreatorWorkspaceSnapshot | null = null;
	let refreshing: Promise<CreatorWorkspaceSnapshot> | null = null;
	let invalidating = false;
	let invalidated = false;
	const prefix = `creator-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const listeners = new Set<(snapshot: CreatorWorkspaceSnapshot) => void>();
	const pending = new Map<
		string,
		{
			resolve(value: unknown): void;
			reject(error: Error): void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	const validSnapshot = (value: unknown): value is CreatorWorkspaceSnapshot =>
		typeof value === "object" &&
		value !== null &&
		typeof Reflect.get(value, "projectId") === "string" &&
		typeof Reflect.get(value, "revision") === "string" &&
		Array.isArray(Reflect.get(value, "documents")) &&
		Array.isArray(Reflect.get(value, "assets")) &&
		(Reflect.get(value, "scopeRevision") === undefined ||
			typeof Reflect.get(value, "scopeRevision") === "string") &&
		Reflect.get(value, "documents").every(
			(document: unknown) =>
				typeof document === "object" &&
				document !== null &&
				["id", "title", "group", "content"].every(
					(key) => typeof Reflect.get(document, key) === "string",
				) &&
				(Reflect.get(document, "revision") === undefined ||
					typeof Reflect.get(document, "revision") === "string") &&
				(Reflect.get(document, "contentState") === undefined ||
					(Reflect.get(document, "contentState") === "unloaded" &&
						Reflect.get(document, "content") === "" &&
						typeof Reflect.get(document, "revision") === "string" &&
						typeof Reflect.get(value, "scopeRevision") === "string")),
		) &&
		Reflect.get(value, "assets").every(
			(asset: unknown) =>
				typeof asset === "object" &&
				asset !== null &&
				["id", "name"].every(
					(key) => typeof Reflect.get(asset, key) === "string",
				) &&
				Array.isArray(Reflect.get(asset, "versions")) &&
				Reflect.get(asset, "versions").every(
					(version: unknown) =>
						typeof version === "object" &&
						version !== null &&
						["id", "label"].every(
							(key) => typeof Reflect.get(version, key) === "string",
						) &&
						["image", "video", "audio", "programmatic"].includes(
							Reflect.get(version, "mediaType"),
						),
				),
		) &&
		(Reflect.get(value, "clipReferences") === undefined ||
			(Array.isArray(Reflect.get(value, "clipReferences")) &&
				Reflect.get(value, "clipReferences").every(
					(pin: unknown) =>
						typeof pin === "object" &&
						pin !== null &&
						[
							"projectId",
							"sceneId",
							"clipId",
							"assetId",
							"versionId",
							"sha256",
						].every(
							(key) =>
								typeof Reflect.get(pin, key) === "string" &&
								Reflect.get(pin, key).length > 0,
						) &&
						(Reflect.get(pin, "status") === undefined ||
							[
								"linked",
								"imported",
								"missing",
								"needs-reconciliation",
							].includes(Reflect.get(pin, "status"))),
				)));
	const onMessage = (event: MessageEvent) => {
		if (
			disposed ||
			event.source !== target.parent ||
			event.origin === "null" ||
			(origin !== null && event.origin !== origin)
		)
			return;
		const data = event.data;
		if (!data || typeof data !== "object" || data.version !== 1) return;
		if (
			data.type === "elftia:creator-workspace-response" &&
			typeof data.requestId === "string"
		) {
			const request = pending.get(data.requestId);
			if (!request) return;
			if (
				origin === null &&
				(!data.ok ||
					(!validSnapshot(data.result) && !isWorkspacePage(data.result)))
			)
				return;
			origin ??= event.origin;
			pending.delete(data.requestId);
			clearTimeout(request.timer);
			if (data.ok === true) request.resolve(data.result);
			else
				request.reject(
					new Error(
						typeof data.error === "string"
							? data.error
							: "Host operation failed",
					),
				);
		} else if (
			origin !== null &&
			data.type === "elftia:creator-workspace-invalidated"
		) {
			invalidated = true;
			if (!invalidating)
				void (async () => {
					invalidating = true;
					try {
						do {
							invalidated = false;
							try {
								const snapshot = await refresh();
								if (!disposed)
									for (const listener of listeners) listener(snapshot);
							} catch {
								/* A subsequent invalidation or explicit read can retry. */
							}
						} while (invalidated && !disposed);
					} finally {
						invalidating = false;
					}
				})();
		} else if (
			origin !== null &&
			data.type === "elftia:creator-workspace-changed" &&
			validSnapshot(data.snapshot)
		) {
			latest = data.snapshot;
			for (const listener of listeners) listener(data.snapshot);
		}
	};
	target.addEventListener("message", onMessage);
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		target.removeEventListener("message", onMessage);
		signal?.removeEventListener("abort", dispose);
		for (const request of pending.values()) {
			clearTimeout(request.timer);
			request.reject(new Error("Project content bridge disconnected"));
		}
		pending.clear();
		listeners.clear();
	};
	signal?.addEventListener("abort", dispose, { once: true });
	const request = ({
		method,
		command,
		knownRevision,
	}: {
		method: "snapshot" | "execute";
		command?: CreatorWorkspaceCommand;
		knownRevision?: string;
	}): Promise<unknown> => {
		if (disposed)
			return Promise.reject(new Error("Project content bridge disconnected"));
		if (pending.size >= 16)
			return Promise.reject(new Error("Too many pending project operations"));
		const requestId = `${prefix}-${++sequence}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => {
					pending.delete(requestId);
					reject(new Error("Project content request timed out"));
				},
				origin === null
					? timeoutMs
					: method === "execute" && fixedNativePlacement(command)
						? 550000
						: 120000,
			);
			pending.set(requestId, { resolve, reject, timer });
			target.parent.postMessage(
				{
					type: "elftia:creator-workspace-request",
					version: 1,
					requestId,
					method,
					transport: {
						version: 1,
						...(knownRevision ? { knownRevision } : {}),
					},
					...(command ? { command } : {}),
				},
				origin ?? "*",
			);
		});
	};
	const assemble = (value: unknown) =>
		isWorkspacePage(value)
			? assembleWorkspacePages({
					initial: value,
					read: (token, index) =>
						request({
							method: "execute",
							command: { type: "workspace.page", token, index },
						}),
				})
			: Promise.resolve(value);
	const remember = (snapshot: CreatorWorkspaceSnapshot) => {
		if (
			latest?.projectId === snapshot.projectId &&
			/^\d+$/.test(latest.revision) &&
			/^\d+$/.test(snapshot.revision) &&
			BigInt(latest.revision) > BigInt(snapshot.revision)
		)
			return latest;
		latest = snapshot;
		return snapshot;
	};
	const refresh = (): Promise<CreatorWorkspaceSnapshot> => {
		if (refreshing) return refreshing;
		refreshing = (async () => {
			const response = await request({
				method: "snapshot",
				knownRevision: latest?.scopeRevision ?? latest?.revision,
			});
			if (
				response &&
				typeof response === "object" &&
				Reflect.get(response, "transport") === "workspace-unchanged-v1"
			) {
				if (
					!latest ||
					Reflect.get(response, "projectId") !== latest.projectId ||
					Reflect.get(response, "revision") !== latest.revision ||
					Reflect.get(response, "scopeRevision") !== latest.scopeRevision
				)
					throw new Error("Invalid unchanged workspace revision");
				return latest;
			}
			const value = await assemble(response);
			if (disposed) throw new Error("Project content bridge disconnected");
			if (!validSnapshot(value)) throw new Error("Invalid project snapshot");
			return remember(value);
		})().finally(() => {
			refreshing = null;
		});
		return refreshing;
	};
	try {
		const initial = await refresh();
		let cached: CreatorWorkspaceSnapshot | null = initial;
		return {
			getSnapshot: async () => {
				if (cached) {
					const value = cached;
					cached = null;
					return latest ?? value;
				}
				return refresh();
			},
			readDocument: async ({ document, snapshot }) => {
				if (document.contentState !== "unloaded") return document;
				if (!document.revision || !snapshot.scopeRevision)
					throw new Error("Document has no fixed revision");
				const result = await assemble(
					await request({
						method: "execute",
						command: {
							type: "document.read",
							projectId: snapshot.projectId,
							projectRevision: snapshot.revision,
							scopeRevision: snapshot.scopeRevision,
							documentId: document.id,
							revision: document.revision,
						},
					}),
				);
				if (disposed) throw new Error("Project content bridge disconnected");
				if (
					!result ||
					typeof result !== "object" ||
					Reflect.get(result, "documentId") !== document.id ||
					Reflect.get(result, "revision") !== document.revision ||
					typeof Reflect.get(result, "content") !== "string"
				)
					throw new Error("Invalid fixed document response");
				return {
					...document,
					contentState: undefined,
					content: Reflect.get(result, "content"),
				};
			},
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			execute: async (command) => {
				if (command.type === "asset.place-version" && command.native) {
					const response = await target.fetch(
						new URL("api/context", target.location.href),
					);
					if (!response.ok) throw new Error("无法确认当前工程状态，请重试");
					const context: unknown = await response.json();
					if (
						!context ||
						typeof context !== "object" ||
						!Number.isSafeInteger(Reflect.get(context, "revision"))
					)
						throw new Error("工程状态响应无效");
					const project: unknown = Reflect.get(context, "project");
					if (
						!project ||
						typeof project !== "object" ||
						Reflect.get(project, "id") !== command.native.projectId ||
						Reflect.get(context, "revision") !== command.native.revision
					)
						throw new Error("工程已更新，请重新载入后再放入时间轴");
				}
				const result = await request({ method: "execute", command });
				if (!result || typeof result !== "object")
					throw new Error("Invalid project operation result");
				if ("snapshot" in result) {
					const snapshot = await assemble(result.snapshot);
					if (!validSnapshot(snapshot))
						throw new Error("Invalid project snapshot");
					return { ...result, snapshot: remember(snapshot) };
				}
				return result;
			},
			dispose,
		};
	} catch {
		dispose();
		return null;
	}
}
