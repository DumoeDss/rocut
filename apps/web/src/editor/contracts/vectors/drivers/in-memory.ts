/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The driver converts published wire data into the contract's branded types at the seam the corpus exists to keep unbranded. */
/**
 * Driver 1 — the in-memory reference target (design D6.1).
 *
 * Proves the corpus and the agent scenario are React-free, Electron-free and
 * browser-free: nothing here touches a Host port, a DOM API or a test runner.
 */
import type { Project, TransactionOperation } from "../..";
import { createInMemoryTransactionStore } from "../..";
import type { VectorTargetFactory, VectorTargetHandle } from "../runner";
import type { VectorSeedDocument } from "../schema";

/** The Project a relative (scenario) run starts from. */
export const IN_MEMORY_SCENARIO_PROJECT = {
	id: "in-memory-project",
	name: "In-memory scenario project",
	frameRate: { numerator: 30, denominator: 1 },
	canvasWidth: 1920,
	canvasHeight: 1080,
} as const;

type SeedableStore = ReturnType<typeof createInMemoryTransactionStore> & {
	_setProject(project: Project): void;
};

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

async function openStore(args: {
	readonly project: unknown;
	readonly document?: VectorSeedDocument;
}): Promise<VectorTargetHandle> {
	const store = createInMemoryTransactionStore() as SeedableStore;
	store._setProject(args.project as Project);
	if (args.document) {
		const operations = seedOperations(args.document);
		if (operations.length > 0) await store.apply({ operations });
	}
	return { target: store };
}

/**
 * A factory over the frozen in-memory fake. It can be seeded, so it runs both
 * families.
 */
export function createInMemoryVectorTargetFactory(): VectorTargetFactory {
	return {
		name: "in-memory-transaction-store",
		openSeeded: ({ document }) =>
			openStore({ project: document.project, document }),
		openRelative: () => openStore({ project: IN_MEMORY_SCENARIO_PROJECT }),
	};
}

/**
 * The same fake with seeding withheld — the control that proves a target which
 * cannot accept a supplied document reports its whole family `unsupported`
 * instead of quietly skipping the vectors it cannot run.
 */
export function createNonSeedableVectorTargetFactory(): VectorTargetFactory {
	return {
		name: "in-memory-transaction-store (no seeding)",
		openRelative: () => openStore({ project: IN_MEMORY_SCENARIO_PROJECT }),
	};
}
