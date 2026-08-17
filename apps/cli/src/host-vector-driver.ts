/**
 * The host-entry conformance driver (S06 C4, D24 §26.7.3).
 *
 * Registers `host start`'s HTTP surface as a `vectors/` driver: the frozen
 * agent scenario and the corpus run against a REAL live host — token-gated
 * loopback HTTP, file-backed store, SSE watch — not against an in-process
 * engine. If the HTTP layer sugars or drifts semantics, the corpus goes red.
 * Lives here (not in editor-contracts' drivers/) because the dependency
 * direction is consumer → contracts, never the reverse.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { frameRate, projectId, revisionOf } from "@opencut/editor-contracts";
import { TransactionError } from "@opencut/editor-contracts";
import type {
	Project,
	Revision,
	TrackId,
	TransactionBatch,
	TransactionErrorCode,
	TransactionResult,
} from "@opencut/editor-contracts";
import type { TransactionValidationOutcome } from "@opencut/editor-contracts/engine";
import type {
	VectorSeedDocument,
	VectorTarget,
	VectorTargetFactory,
	VectorTargetHandle,
} from "@opencut/editor-contracts/vectors";
import { TargetRegistry } from "./target-registry";
import { startHost } from "./host";
import type { RunningHost } from "./host";
import type { AutomationApi } from "@opencut/editor-automation";

export const HOST_SCENARIO_PROJECT: Project = {
	id: projectId("host-http-scenario"),
	name: "Host HTTP scenario project",
	frameRate: frameRate({ numerator: 30, denominator: 1 }),
	canvasWidth: 1920,
	canvasHeight: 1080,
};

/** The HTTP face of a running host, as a VectorTarget. */
export class HttpVectorTarget implements VectorTarget {
	private readonly subscribers = new Set<(revision: Revision) => void>();

	private constructor(
		private readonly host: RunningHost,
		private readonly projectRoot: string,
	) {}

	static async open(args?: {
		readonly seedProject?: Project;
	}): Promise<HttpVectorTarget> {
		const projectRoot = await mkdtemp(path.join(tmpdir(), "rocut-vector-"));
		const host = await startHost({
			projectRoot,
			registry: new TargetRegistry(
				path.join(projectRoot, "..", `${path.basename(projectRoot)}-targets`),
			),
		});
		const target = new HttpVectorTarget(host, projectRoot);
		if (args?.seedProject) {
			await target.apply({
				operations: [
					{
						kind: "update-project",
						projectId: args.seedProject.id,
						patch: {
							name: args.seedProject.name,
							frameRate: args.seedProject.frameRate,
							canvasWidth: args.seedProject.canvasWidth,
							canvasHeight: args.seedProject.canvasHeight,
						},
					},
				],
			});
		}
		return target;
	}

	private get base(): string {
		return `http://127.0.0.1:${this.host.port}/${this.host.token}`;
	}

	private async getJson(route: string): Promise<unknown> {
		const response = await fetch(`${this.base}/api/${route}`);
		if (!response.ok) throw new Error(`GET ${route} -> ${response.status}`);
		return response.json();
	}

	async tracks() {
		return (await this.getJson("tracks")) as Awaited<
			ReturnType<AutomationApi["tracks"]>
		>;
	}
	async clips(filter?: { trackId: TrackId }) {
		const all = (await this.getJson("clips")) as Awaited<
			ReturnType<AutomationApi["clips"]>
		>;
		return filter ? all.filter((clip) => clip.trackId === filter.trackId) : all;
	}
	async assets() {
		return (await this.getJson("assets")) as Awaited<
			ReturnType<AutomationApi["assets"]>
		>;
	}
	async markers() {
		return (await this.getJson("markers")) as Awaited<
			ReturnType<AutomationApi["markers"]>
		>;
	}
	async project() {
		const context = (await this.getJson("context")) as {
			project: Project | null;
		};
		return context.project;
	}
	async revision() {
		const context = (await this.getJson("context")) as { revision: number };
		return revisionOf(context.revision);
	}
	async capabilities() {
		const context = (await this.getJson("context")) as {
			capabilities: Readonly<Record<string, boolean>>;
		};
		return context.capabilities;
	}
	async supportedOperations() {
		const context = (await this.getJson("context")) as {
			supportedOperations: readonly string[];
		};
		return context.supportedOperations as Awaited<
			ReturnType<AutomationApi["supportedOperations"]>
		>;
	}
	async apply(batch: TransactionBatch): Promise<TransactionResult> {
		// Establish the poller baseline before the mutation so a subscriber
		// that just registered cannot miss this revision change.
		if (this.subscribers.size > 0 && this.seenRevision === null) {
			const context = (await this.getJson("context")) as { revision: number };
			this.seenRevision = context.revision;
		}
		const response = await fetch(`${this.base}/api/apply`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				operations: batch.operations,
				...(batch.expectedRevision === undefined
					? {}
					: { expectedRevision: Number(batch.expectedRevision) }),
				...(batch.idempotencyKey === undefined
					? {}
					: { idempotencyKey: batch.idempotencyKey }),
			}),
		});
		const parsed = (await response.json()) as {
			accepted: boolean;
			code?: string;
			message?: string;
			revision?: number;
			createdIds?: string[];
			changedIds?: string[];
			expectedRevision?: number;
			actualRevision?: number;
		};
		if (!response.ok || parsed.accepted !== true) {
			// The conformance runner only branches on TransactionError — the
			// wire rethrows it with the structured code and revisions intact.
			if (parsed.code !== undefined) {
				throw new TransactionError({
					code: parsed.code as TransactionErrorCode,
					message: parsed.message ?? "apply rejected",
					...(parsed.expectedRevision === undefined
						? {}
						: { expectedRevision: revisionOf(parsed.expectedRevision) }),
					...(parsed.actualRevision === undefined
						? {}
						: { actualRevision: revisionOf(parsed.actualRevision) }),
				});
			}
			throw new Error(
				`apply rejected (${response.status}): ${parsed.message ?? "unknown"}`,
			);
		}
		const resultRevision = parsed.revision ?? 0;
		if (this.subscribers.size > 0) {
			await this.awaitDelivery(resultRevision);
		}
		return {
			revision: revisionOf(resultRevision),
			createdIds: parsed.createdIds ?? [],
			changedIds: parsed.changedIds ?? [],
		};
	}
	watch(callback: (revision: Revision) => void): () => void {
		this.ensurePoller();
		this.subscribers.add(callback);
		return () => {
			this.subscribers.delete(callback);
		};
	}

	/**
	 * One shared revision poller. The host also exposes an SSE endpoint, but
	 * same-process streaming fetch against its own node:http server is not
	 * portable across bun runtimes — and the conformance runner counts
	 * watcher notifications synchronously after `apply` resolves, so `apply`
	 * waits until every subscriber has observed the new revision before
	 * returning (bounded, fail-loud downstream).
	 */
	private poller?: ReturnType<typeof setInterval>;
	private seenRevision: number | null = null;
	private ensurePoller(): void {
		if (this.poller !== undefined) return;
		this.poller = setInterval(() => {
			void (async () => {
				try {
					const context = (await this.getJson("context")) as {
						revision: number;
					};
					if (this.seenRevision === null) {
						this.seenRevision = context.revision;
						return;
					}
					if (context.revision <= this.seenRevision) return;
					this.seenRevision = context.revision;
					for (const subscriber of [...this.subscribers]) {
						subscriber(revisionOf(context.revision));
					}
				} catch {
					// Host closed — subscribers simply stop hearing changes.
				}
			})();
		}, 2);
	}

	private async awaitDelivery(revision: number): Promise<void> {
		const deadline = Date.now() + 2_000;
		while (this.seenRevision === null || this.seenRevision < revision) {
			if (Date.now() > deadline) return; // fail loud downstream, never hang
			await new Promise((resolve) => setTimeout(resolve, 2));
		}
	}
	async validate(
		batch: TransactionBatch,
	): Promise<TransactionValidationOutcome> {
		void batch;
		throw new Error("validate is not projected over the host HTTP surface");
	}

	/** Close the host but KEEP the project directory (reopen leg). */
	async closeKeepingProject(): Promise<string> {
		if (this.poller !== undefined) clearInterval(this.poller);
		await this.host.close();
		return this.projectRoot;
	}
}

export function createHostVectorTargetFactory(): VectorTargetFactory {
	return {
		name: "host-http-start",
		openSeeded: async ({ document }) => {
			const target = await HttpVectorTarget.open({
				seedProject: document.project as Project,
			});
			await seedDocumentOperations(target, document);
			return {
				target,
				close: () => target.closeKeepingProject().then(() => undefined),
			};
		},
		openRelative: async () => {
			const target = await HttpVectorTarget.open({
				seedProject: HOST_SCENARIO_PROJECT,
			});
			return {
				target,
				close: () => target.closeKeepingProject().then(() => undefined),
			};
		},
	};
}

async function seedDocumentOperations(
	target: HttpVectorTarget,
	document: VectorSeedDocument,
): Promise<void> {
	const operations = [
		...document.tracks.map((track) => ({ kind: "create-track", track })),
		...document.assets.map((asset) => ({ kind: "create-asset", asset })),
		...document.clips.map((clip) => ({ kind: "create-clip", clip })),
		...document.markers.map((marker) => ({ kind: "create-marker", marker })),
	] as unknown as Parameters<VectorTarget["apply"]>[0]["operations"];
	if (operations.length > 0) await target.apply({ operations });
}

export async function withTempDir(
	run: (dir: string) => Promise<void>,
): Promise<void> {
	const dir = await mkdtemp(path.join(tmpdir(), "rocut-vector-"));
	try {
		await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
