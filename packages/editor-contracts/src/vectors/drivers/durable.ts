/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The driver converts published wire data into the contract's branded types and port identities at the seam. */
/**
 * Driver 2 — the durable engine over an in-memory `ProjectStore` (design D6.2).
 *
 * Same scenario, durable semantics: real revisions written through a store,
 * real idempotency at rest, and a reopen that decodes the record again rather
 * than reading a live object. Still Node-only — no React, no Electron, no
 * browser.
 *
 * The store wrapper counts saves and can be told to reject or delay the next
 * one, which is what the durability controls in `__tests__/agent-drivers.test.ts`
 * need: a save that rejects must move nothing, and a save that is slow must
 * reach the same verdicts.
 */
import type { Project, TransactionOperation } from "../..";
import {
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
	openTransactionEngine,
	type TransactionEngine,
} from "../../engine";
import type { ProjectId, ProjectRecord, ProjectSummary } from "@opencut/editor-ports";
import { InMemoryProjectStore } from "@opencut/editor-ports/in-memory";
import type { VectorTargetFactory, VectorTargetHandle } from "../runner";
import type { VectorSeedDocument } from "../schema";

/** The Project a relative (scenario) run starts from. */
export const DURABLE_SCENARIO_PROJECT = {
	id: "durable-project",
	name: "Durable scenario project",
	frameRate: { numerator: 30, denominator: 1 },
	canvasWidth: 1920,
	canvasHeight: 1080,
} as const;

export interface DurableSaveControl {
	/** Cumulative successful saves observed by this store. */
	saves(): number;
	/** Cumulative saves that entered the store, settled or parked. */
	attempts(): number;
	/** Reject the next save with this error, once. */
	failNextSave(error: Error): void;
	/**
	 * Park every save until the returned release is called.
	 *
	 * A deliberately slow store, expressed as a deferred rather than a sleep:
	 * the delay is exactly as long as the test holds it, so the control proves
	 * the driver waits on observable committed state without making the suite
	 * depend on the clock.
	 */
	blockSaves(): () => void;
	/** Resolves the next time a save enters the store. */
	whenSaveAttempted(): Promise<void>;
}

class ObservedProjectStore extends InMemoryProjectStore {
	private saveCount = 0;
	private attemptCount = 0;
	private pendingFailure: Error | null = null;
	private gate: Promise<void> | null = null;
	private readonly attemptWaiters: Array<() => void> = [];

	readonly saveControl: DurableSaveControl = {
		saves: () => this.saveCount,
		attempts: () => this.attemptCount,
		failNextSave: (error: Error) => {
			this.pendingFailure = error;
		},
		blockSaves: () => {
			let open: () => void = () => {};
			this.gate = new Promise<void>((resolve) => {
				open = resolve;
			});
			return () => {
				this.gate = null;
				open();
			};
		},
		whenSaveAttempted: () =>
			new Promise<void>((resolve) => {
				this.attemptWaiters.push(resolve);
			}),
	};

	override async save(args: {
		record: ProjectRecord;
		summary: ProjectSummary;
		signal?: AbortSignal;
	}): Promise<void> {
		this.attemptCount += 1;
		for (const waiter of this.attemptWaiters.splice(0)) waiter();
		// Park before the failure check and before the write, so a blocked save
		// has genuinely committed nothing while the test observes it.
		if (this.gate) await this.gate;
		const failure = this.pendingFailure;
		if (failure) {
			this.pendingFailure = null;
			throw failure;
		}
		await super.save(args);
		this.saveCount += 1;
	}
}

export interface DurableTarget {
	readonly engine: TransactionEngine;
	readonly store: ObservedProjectStore;
	readonly control: DurableSaveControl;
	readonly projectId: string;
}

function seedOperations(
	document: VectorSeedDocument,
): readonly TransactionOperation[] {
	return [
		...document.tracks.map((track) => ({ kind: "create-track", track })),
		...document.assets.map((asset) => ({ kind: "create-asset", asset })),
		...document.clips.map((clip) => ({ kind: "create-clip", clip })),
		...document.markers.map((marker) => ({ kind: "create-marker", marker })),
	] as unknown as readonly TransactionOperation[];
}

/** Create a store already holding one seeded, transaction-shaped project. */
export async function createDurableProjectStore(args: {
	readonly project: unknown;
}): Promise<ObservedProjectStore> {
	const store = new ObservedProjectStore();
	const project = args.project as Project;
	const seed = createTransactionNativeProjectSeed({
		projectId: String(project.id) as ProjectId,
		project,
	});
	await store.save({ record: seed.record, summary: seed.summary });
	return store;
}

/** Open (or reopen) a durable engine over an existing store. */
export async function openDurableTarget(args: {
	readonly store: ObservedProjectStore;
	readonly projectId: string;
}): Promise<DurableTarget> {
	const engine = await openTransactionEngine({
		store: args.store,
		projectId: args.projectId as ProjectId,
		documentAdapter: createTransactionNativeDocumentAdapter(),
	});
	return {
		engine,
		store: args.store,
		control: args.store.saveControl,
		projectId: args.projectId,
	};
}

/** Open a fresh durable target, optionally holding a supplied document. */
export async function openDurableVectorTarget(args: {
	readonly project: unknown;
	readonly document?: VectorSeedDocument;
}): Promise<DurableTarget> {
	const store = await createDurableProjectStore({ project: args.project });
	const opened = await openDurableTarget({
		store,
		projectId: String((args.project as Project).id),
	});
	if (args.document) {
		const operations = seedOperations(args.document);
		if (operations.length > 0) await opened.engine.apply({ operations });
	}
	return opened;
}

export function createDurableVectorTargetFactory(): VectorTargetFactory {
	const open = async (args: {
		readonly project: unknown;
		readonly document?: VectorSeedDocument;
	}): Promise<VectorTargetHandle> => {
		const opened = await openDurableVectorTarget(args);
		return { target: opened.engine };
	};
	return {
		name: "durable-transaction-engine",
		openSeeded: ({ document }) => open({ project: document.project, document }),
		openRelative: () => open({ project: DURABLE_SCENARIO_PROJECT }),
	};
}
