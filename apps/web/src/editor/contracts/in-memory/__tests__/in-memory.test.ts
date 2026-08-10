import { describe, expect, test } from "bun:test";
import type { Project } from "../..";
import {
	clipId,
	createInMemoryTransactionStore,
	projectId,
	runTransactionConformance,
	TransactionError,
} from "../..";
import type { InMemoryTransactionStore } from "..";

const PROJECT_ID = projectId("in-memory-project");

function project(): Project {
	return {
		id: PROJECT_ID,
		name: "In-memory Project",
		frameRate: { numerator: 30, denominator: 1 },
		canvasWidth: 1920,
		canvasHeight: 1080,
	};
}

function seededStore(): InMemoryTransactionStore {
	const store = createInMemoryTransactionStore();
	(
		store as InMemoryTransactionStore & { _setProject(value: Project): void }
	)._setProject(project());
	return store;
}

function adversarialFrameRates(): readonly {
	readonly name: string;
	readonly value: unknown;
}[] {
	const symbolValue = { numerator: 30, denominator: 1 } as Record<
		PropertyKey,
		unknown
	>;
	symbolValue[Symbol("provider-private")] = true;
	const accessorValue: Record<string, unknown> = { denominator: 1 };
	Object.defineProperty(accessorValue, "numerator", {
		enumerable: true,
		get() {
			throw new Error("frame-rate accessors must not be invoked");
		},
	});
	const nonEnumerableValue: Record<string, unknown> = { numerator: 30 };
	Object.defineProperty(nonEnumerableValue, "denominator", {
		enumerable: false,
		value: 1,
	});
	return [
		{
			name: "provider-private excess key",
			value: { numerator: 30, denominator: 1, providerPrivate: "smuggle" },
		},
		{ name: "symbol key", value: symbolValue },
		{ name: "accessor", value: accessorValue },
		{ name: "non-enumerable field", value: nonEnumerableValue },
	];
}

async function expectRejectedWithoutMutation(args: {
	readonly store: InMemoryTransactionStore;
	readonly projectId?: ReturnType<typeof projectId>;
	readonly patch: unknown;
	readonly code?: "validation" | "not-found";
}): Promise<void> {
	const beforeProject = await args.store.project();
	const beforeRevision = await args.store.revision();
	let failure: unknown;
	try {
		await args.store.apply({
			operations: [
				{
					kind: "update-project",
					projectId: args.projectId ?? PROJECT_ID,
					patch: args.patch,
				} as never,
			],
		});
	} catch (error) {
		failure = error;
	}
	expect(failure).toBeInstanceOf(TransactionError);
	expect((failure as TransactionError).code).toBe(args.code ?? "validation");
	expect((failure as TransactionError).operationIndex).toBe(0);
	expect(await args.store.project()).toEqual(beforeProject);
	expect(await args.store.revision()).toBe(beforeRevision);
}

describe("in-memory transaction Project updates", () => {
	test("passes T0 conformance with the seeded Project case executed", async () => {
		const store = seededStore();
		const report = await runTransactionConformance({
			target: { read: store, apply: store, getContext: store, watch: store },
			label: "seeded in-memory reference",
		});
		if (!report.passed) {
			throw new Error(
				report.results
					.filter((entry) => entry.status === "failed")
					.map((entry) => `${entry.name}: ${entry.detail}`)
					.join("\n"),
			);
		}
		expect(
			report.results.find(
				(entry) =>
					entry.name === "Project updates execute atomically and idempotently",
			)?.status,
		).toBe("passed");
	});

	test("rejects empty, excess, symbol, id, malformed, missing, and mismatched patches", async () => {
		const symbolPatch = { name: "still invalid" } as Record<
			PropertyKey,
			unknown
		>;
		symbolPatch[Symbol("private")] = true;
		const invalidPatches: readonly unknown[] = [
			{},
			{ id: projectId("smuggled") },
			{ providerPrivate: true },
			symbolPatch,
			{ name: "" },
			{ canvasWidth: 0 },
			{ canvasWidth: Number.POSITIVE_INFINITY },
			{ canvasHeight: -1 },
			{ frameRate: { numerator: 0, denominator: 1 } },
			{ frameRate: { numerator: 90, denominator: 1 } },
			...adversarialFrameRates().map(({ value }) => ({ frameRate: value })),
		];
		for (const patch of invalidPatches) {
			await expectRejectedWithoutMutation({ store: seededStore(), patch });
		}
		await expectRejectedWithoutMutation({
			store: seededStore(),
			projectId: projectId("other-project"),
			patch: { name: "Mismatch" },
			code: "not-found",
		});
		await expectRejectedWithoutMutation({
			store: createInMemoryTransactionStore(),
			patch: { name: "Missing" },
			code: "not-found",
		});
	});

	test("gives canonical keyed collisions precedence over serializable invalid Project patches", async () => {
		const store = seededStore();
		const committed = await store.apply({
			operations: [
				{
					kind: "update-project",
					projectId: PROJECT_ID,
					patch: { name: "Keyed Project" },
				},
			],
			idempotencyKey: "project-collision-key",
		});
		for (const patch of [{}, { providerPrivate: true }]) {
			let failure: unknown;
			const operation = {
				kind: "update-project" as const,
				projectId: PROJECT_ID,
				patch: {},
			};
			for (const [key, value] of Object.entries(patch)) {
				Reflect.set(operation.patch, key, value);
			}
			try {
				await store.apply({
					operations: [operation],
					idempotencyKey: "project-collision-key",
				});
			} catch (error) {
				failure = error;
			}
			expect(failure).toBeInstanceOf(TransactionError);
			if (!(failure instanceof TransactionError)) throw failure;
			expect(failure.code).toBe("duplicate");
		}
		expect(await store.project()).toEqual({
			...project(),
			name: "Keyed Project",
		});
		expect(await store.revision()).toBe(committed.revision);
	});

	test("commits a same-value patch once and rolls it back on a later failure", async () => {
		const store = seededStore();
		const watched: number[] = [];
		store.watch((revision) => watched.push(Number(revision)));
		const sameValue = await store.apply({
			operations: [
				{
					kind: "update-project",
					projectId: PROJECT_ID,
					patch: { name: project().name },
				},
			],
		});
		expect(sameValue.changedIds).toEqual([PROJECT_ID]);
		expect(sameValue.createdIds).toEqual([]);
		expect(watched).toEqual([1]);

		await expect(
			store.apply({
				operations: [
					{
						kind: "update-project",
						projectId: PROJECT_ID,
						patch: { name: "must roll back" },
					},
					{ kind: "delete-clip", clipId: clipId("missing") },
				],
			}),
		).rejects.toBeInstanceOf(TransactionError);
		expect((await store.project())?.name).toBe(project().name);
		expect(Number(await store.revision())).toBe(1);
		expect(watched).toEqual([1]);
	});
});
