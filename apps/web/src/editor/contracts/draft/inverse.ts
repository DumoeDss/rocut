import type {
	Asset,
	AssetId,
	Clip,
	Marker,
	ProjectPatch,
	Track,
	TransactionOperation,
} from "..";
import type { TransactionEngineDocument } from "../engine";
import { cloneDraftValue } from "./immutable";
import type { DraftContentSnapshot } from "./types";

type OrderedEntity = Track | Clip | Asset | Marker;

const PROJECT_PATCH_KEYS = [
	"name",
	"frameRate",
	"canvasWidth",
	"canvasHeight",
] as const satisfies readonly (keyof ProjectPatch)[];

interface EntityRepair {
	readonly replace: boolean;
	readonly patch: Readonly<Record<string, unknown>>;
}

interface CollectionCompensationPlan<Entity extends OrderedEntity> {
	readonly deletes: readonly Entity[];
	readonly creates: readonly Entity[];
	readonly updates: readonly TransactionOperation[];
	readonly recreatedIds: ReadonlySet<string>;
}

interface DraftDataPairs {
	readonly leftToRight: WeakMap<object, object>;
	readonly rightToLeft: WeakMap<object, object>;
}

function createDraftDataPairs(): DraftDataPairs {
	return {
		leftToRight: new WeakMap(),
		rightToLeft: new WeakMap(),
	};
}

function sameDraftOwnDataProperties(
	left: object,
	right: object,
	pairs: DraftDataPairs,
): boolean {
	const leftKeys = Reflect.ownKeys(left);
	const rightKeys = Reflect.ownKeys(right);
	if (leftKeys.length !== rightKeys.length) return false;
	for (const key of leftKeys) {
		const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
		const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
		if (
			leftDescriptor === undefined ||
			rightDescriptor === undefined ||
			!("value" in leftDescriptor) ||
			!("value" in rightDescriptor) ||
			leftDescriptor.enumerable !== rightDescriptor.enumerable ||
			!sameDraftData(leftDescriptor.value, rightDescriptor.value, pairs)
		) {
			return false;
		}
	}
	return true;
}

function sameDraftData(
	left: unknown,
	right: unknown,
	pairs: DraftDataPairs = createDraftDataPairs(),
): boolean {
	if (
		left === null ||
		right === null ||
		typeof left !== "object" ||
		typeof right !== "object"
	) {
		return Object.is(left, right);
	}
	const pairedRight = pairs.leftToRight.get(left);
	if (pairedRight !== undefined) return pairedRight === right;
	const pairedLeft = pairs.rightToLeft.get(right);
	if (pairedLeft !== undefined) return pairedLeft === left;
	pairs.leftToRight.set(left, right);
	pairs.rightToLeft.set(right, left);
	// A first-seen identical object is not terminal: its descendants must enter
	// the bijection before a later path can prove whether an alias was collapsed
	// or split. Only the already-paired branches above terminate object cycles.

	if (left instanceof Date || right instanceof Date) {
		return (
			left instanceof Date &&
			right instanceof Date &&
			Object.is(
				Date.prototype.getTime.call(left),
				Date.prototype.getTime.call(right),
			) &&
			sameDraftOwnDataProperties(left, right, pairs)
		);
	}
	if (left instanceof RegExp || right instanceof RegExp) {
		return (
			left instanceof RegExp &&
			right instanceof RegExp &&
			left.source === right.source &&
			left.flags === right.flags &&
			left.lastIndex === right.lastIndex &&
			sameDraftOwnDataProperties(left, right, pairs)
		);
	}
	if (left instanceof Map || right instanceof Map) {
		if (!(left instanceof Map) || !(right instanceof Map)) return false;
		if (left.size !== right.size) return false;
		const leftEntries = [...left.entries()];
		const rightEntries = [...right.entries()];
		return (
			leftEntries.every(
				([key, value], index) =>
					sameDraftData(key, rightEntries[index]?.[0], pairs) &&
					sameDraftData(value, rightEntries[index]?.[1], pairs),
			) && sameDraftOwnDataProperties(left, right, pairs)
		);
	}
	if (left instanceof Set || right instanceof Set) {
		if (!(left instanceof Set) || !(right instanceof Set)) return false;
		if (left.size !== right.size) return false;
		const leftValues = [...left.values()];
		const rightValues = [...right.values()];
		return (
			leftValues.every((value, index) =>
				sameDraftData(value, rightValues[index], pairs),
			) && sameDraftOwnDataProperties(left, right, pairs)
		);
	}
	if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
		if (!ArrayBuffer.isView(left) || !ArrayBuffer.isView(right)) return false;
		if (
			left.constructor !== right.constructor ||
			left.byteOffset !== right.byteOffset ||
			left.byteLength !== right.byteLength
		) {
			return false;
		}
		return (
			sameDraftData(left.buffer, right.buffer, pairs) &&
			sameDraftOwnDataProperties(left, right, pairs)
		);
	}
	if (left instanceof ArrayBuffer || right instanceof ArrayBuffer) {
		if (!(left instanceof ArrayBuffer) || !(right instanceof ArrayBuffer)) {
			return false;
		}
		if (left.byteLength !== right.byteLength) return false;
		const leftBytes = new Uint8Array(left);
		const rightBytes = new Uint8Array(right);
		return (
			leftBytes.every((value, index) => value === rightBytes[index]) &&
			sameDraftOwnDataProperties(left, right, pairs)
		);
	}

	if (Array.isArray(left) !== Array.isArray(right)) return false;
	return sameDraftOwnDataProperties(left, right, pairs);
}

export function hasSameDraftContent(
	left: Pick<
		DraftContentSnapshot,
		"project" | "tracks" | "clips" | "assets" | "markers"
	>,
	right: Pick<
		DraftContentSnapshot,
		"project" | "tracks" | "clips" | "assets" | "markers"
	>,
): boolean {
	const pairs = createDraftDataPairs();
	return (
		sameDraftData(left.project, right.project, pairs) &&
		sameDraftData(left.tracks, right.tracks, pairs) &&
		sameDraftData(left.clips, right.clips, pairs) &&
		sameDraftData(left.assets, right.assets, pairs) &&
		sameDraftData(left.markers, right.markers, pairs)
	);
}

/** Compare the independently cloned public read roots without requiring
 * aliases that cross two separate read calls to survive those calls. */
export function hasSameDraftReadableContent(
	left: Pick<
		DraftContentSnapshot,
		"project" | "tracks" | "clips" | "assets" | "markers"
	>,
	right: Pick<
		DraftContentSnapshot,
		"project" | "tracks" | "clips" | "assets" | "markers"
	>,
): boolean {
	return (
		sameDraftData(left.project, right.project) &&
		sameDraftData(left.tracks, right.tracks) &&
		sameDraftData(left.clips, right.clips) &&
		sameDraftData(left.assets, right.assets) &&
		sameDraftData(left.markers, right.markers)
	);
}

export function hasSameDraftTransactionDocument(
	left: TransactionEngineDocument,
	right: TransactionEngineDocument,
): boolean {
	return sameDraftData(left, right);
}

interface DraftAliasPair {
	readonly counterpart: object;
	readonly owners: Set<string>;
}

interface DraftAliasPairs {
	readonly leftToRight: WeakMap<object, DraftAliasPair>;
	readonly rightToLeft: WeakMap<object, DraftAliasPair>;
}

function addAliasOwner(owners: Set<string>, owner: string | undefined): void {
	if (owner !== undefined) owners.add(owner);
}

function addAliasRepairs(
	repairs: Set<string>,
	owner: string | undefined,
	...pairs: Array<DraftAliasPair | undefined>
): void {
	if (owner !== undefined) repairs.add(owner);
	for (const pair of pairs) {
		if (pair === undefined) continue;
		for (const priorOwner of pair.owners) repairs.add(priorOwner);
	}
}

function inspectDraftAliases(args: {
	readonly left: unknown;
	readonly right: unknown;
	readonly owner: string | undefined;
	readonly pairs: DraftAliasPairs;
	readonly repairs: Set<string>;
}): void {
	const { left, right, owner, pairs, repairs } = args;
	if (
		left === null ||
		right === null ||
		typeof left !== "object" ||
		typeof right !== "object"
	) {
		return;
	}

	const pairedRight = pairs.leftToRight.get(left);
	const pairedLeft = pairs.rightToLeft.get(right);
	if (
		(pairedRight !== undefined && pairedRight.counterpart !== right) ||
		(pairedLeft !== undefined && pairedLeft.counterpart !== left)
	) {
		addAliasRepairs(repairs, owner, pairedRight, pairedLeft);
		return;
	}
	if (pairedRight !== undefined || pairedLeft !== undefined) {
		if (pairedRight !== undefined) addAliasOwner(pairedRight.owners, owner);
		if (pairedLeft !== undefined) addAliasOwner(pairedLeft.owners, owner);
		return;
	}

	const owners = new Set<string>();
	addAliasOwner(owners, owner);
	pairs.leftToRight.set(left, { counterpart: right, owners });
	pairs.rightToLeft.set(right, { counterpart: left, owners });

	const inspect = (nextLeft: unknown, nextRight: unknown): void =>
		inspectDraftAliases({
			left: nextLeft,
			right: nextRight,
			owner,
			pairs,
			repairs,
		});

	if (left instanceof Map || right instanceof Map) {
		if (!(left instanceof Map) || !(right instanceof Map)) return;
		const leftEntries = [...left.entries()];
		const rightEntries = [...right.entries()];
		for (
			let index = 0;
			index < Math.min(leftEntries.length, rightEntries.length);
			index += 1
		) {
			inspect(leftEntries[index]?.[0], rightEntries[index]?.[0]);
			inspect(leftEntries[index]?.[1], rightEntries[index]?.[1]);
		}
	} else if (left instanceof Set || right instanceof Set) {
		if (!(left instanceof Set) || !(right instanceof Set)) return;
		const leftValues = [...left.values()];
		const rightValues = [...right.values()];
		for (
			let index = 0;
			index < Math.min(leftValues.length, rightValues.length);
			index += 1
		) {
			inspect(leftValues[index], rightValues[index]);
		}
	} else if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
		if (!ArrayBuffer.isView(left) || !ArrayBuffer.isView(right)) return;
		inspect(left.buffer, right.buffer);
	} else if (
		left instanceof Date ||
		right instanceof Date ||
		left instanceof RegExp ||
		right instanceof RegExp ||
		left instanceof ArrayBuffer ||
		right instanceof ArrayBuffer
	) {
		// Native internal slots contain no object descendants. Their custom data
		// properties, when present, are still walked below.
	}

	const rightKeys = new Set(Reflect.ownKeys(right));
	for (const key of Reflect.ownKeys(left)) {
		if (!rightKeys.has(key)) continue;
		const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
		const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
		if (
			leftDescriptor !== undefined &&
			rightDescriptor !== undefined &&
			"value" in leftDescriptor &&
			"value" in rightDescriptor
		) {
			inspect(leftDescriptor.value, rightDescriptor.value);
		}
	}
}

function collectDocumentAliasRepairIds(args: {
	readonly base: DraftContentSnapshot;
	readonly candidate: DraftContentSnapshot;
}): ReadonlySet<string> {
	const pairs: DraftAliasPairs = {
		leftToRight: new WeakMap(),
		rightToLeft: new WeakMap(),
	};
	const repairs = new Set<string>();
	inspectDraftAliases({
		left: args.base.project,
		right: args.candidate.project,
		owner: undefined,
		pairs,
		repairs,
	});
	for (const [baseEntities, candidateEntities] of [
		[args.base.tracks, args.candidate.tracks],
		[args.base.clips, args.candidate.clips],
		[args.base.assets, args.candidate.assets],
		[args.base.markers, args.candidate.markers],
	] as const) {
		const candidateById = new Map(
			candidateEntities.map((entity) => [entity.id, entity]),
		);
		for (const baseEntity of baseEntities) {
			const candidateEntity = candidateById.get(baseEntity.id);
			if (candidateEntity === undefined) continue;
			inspectDraftAliases({
				left: baseEntity,
				right: candidateEntity,
				owner: baseEntity.id,
				pairs,
				repairs,
			});
		}
	}
	return repairs;
}

function entityRepair(args: {
	readonly base: OrderedEntity;
	readonly candidate: OrderedEntity;
	readonly forceFullPatch: boolean;
}): EntityRepair {
	const patch: Record<string, unknown> = {};
	for (const key of Reflect.ownKeys(args.candidate)) {
		if (key === "id") continue;
		if (typeof key !== "string" || !Object.hasOwn(args.base, key)) {
			return { replace: true, patch: {} };
		}
		const descriptor = Object.getOwnPropertyDescriptor(args.candidate, key);
		if (descriptor === undefined || !("value" in descriptor)) {
			return { replace: true, patch: {} };
		}
	}
	for (const key of Reflect.ownKeys(args.base)) {
		if (key === "id") continue;
		if (typeof key !== "string") return { replace: true, patch: {} };
		const baseDescriptor = Object.getOwnPropertyDescriptor(args.base, key);
		const candidateDescriptor = Object.getOwnPropertyDescriptor(
			args.candidate,
			key,
		);
		if (baseDescriptor === undefined || !("value" in baseDescriptor)) {
			return { replace: true, patch: {} };
		}
		if (
			candidateDescriptor === undefined ||
			!("value" in candidateDescriptor) ||
			!sameDraftData(baseDescriptor.value, candidateDescriptor.value)
		) {
			patch[key] = baseDescriptor.value;
		}
	}
	if (
		!args.forceFullPatch &&
		sameDraftData({ ...args.candidate, ...patch }, args.base)
	) {
		return { replace: false, patch };
	}

	// A per-property value comparison can be equal while the entity's alias
	// topology differs across properties. In that case patch the complete
	// pre-image as one cloned graph so shared/distinct references are restored.
	const fullPatch: Record<string, unknown> = {};
	for (const key of Reflect.ownKeys(args.base)) {
		if (key === "id") continue;
		if (typeof key !== "string") return { replace: true, patch: {} };
		const descriptor = Object.getOwnPropertyDescriptor(args.base, key);
		if (descriptor === undefined || !("value" in descriptor)) {
			return { replace: true, patch: {} };
		}
		fullPatch[key] = descriptor.value;
	}
	return sameDraftData({ ...args.candidate, ...fullPatch }, args.base)
		? { replace: false, patch: fullPatch }
		: { replace: true, patch: {} };
}

function planCollectionCompensation<Entity extends OrderedEntity>(args: {
	readonly base: readonly Entity[];
	readonly candidate: readonly Entity[];
	readonly canUpdate: boolean;
	readonly aliasRepairIds: ReadonlySet<string>;
	readonly forceReplace?: (base: Entity, candidate: Entity) => boolean;
	readonly update: (
		base: Entity,
		patch: Readonly<Record<string, unknown>>,
	) => TransactionOperation;
}): CollectionCompensationPlan<Entity> {
	const baseIndexById = new Map(
		args.base.map((entity, index) => [entity.id, index]),
	);
	const candidateIndexById = new Map(
		args.candidate.map((entity, index) => [entity.id, index]),
	);
	const candidateById = new Map(
		args.candidate.map((entity) => [entity.id, entity]),
	);
	const repairs = new Map<string, EntityRepair>();
	let retainedPrefixLength = args.base.length;
	let candidateCursor = -1;

	for (let baseIndex = 0; baseIndex < args.base.length; baseIndex += 1) {
		const baseEntity = args.base[baseIndex];
		if (baseEntity === undefined) continue;
		const candidateIndex = candidateIndexById.get(baseEntity.id);
		const candidateEntity = candidateById.get(baseEntity.id);
		if (candidateIndex === undefined || candidateEntity === undefined) {
			retainedPrefixLength = baseIndex;
			break;
		}
		const repair = entityRepair({
			base: baseEntity,
			candidate: candidateEntity,
			forceFullPatch: args.aliasRepairIds.has(baseEntity.id),
		});
		repairs.set(baseEntity.id, repair);
		if (
			candidateIndex <= candidateCursor ||
			(!args.canUpdate && !sameDraftData(baseEntity, candidateEntity)) ||
			(!args.canUpdate && args.aliasRepairIds.has(baseEntity.id)) ||
			repair.replace ||
			(args.forceReplace?.(baseEntity, candidateEntity) ?? false)
		) {
			retainedPrefixLength = baseIndex;
			break;
		}
		candidateCursor = candidateIndex;
	}

	const recreatedIds = new Set(
		args.base.slice(retainedPrefixLength).map((entity) => entity.id),
	);
	const deletes = args.candidate.filter((entity) => {
		const baseIndex = baseIndexById.get(entity.id);
		return baseIndex === undefined || baseIndex >= retainedPrefixLength;
	});
	const creates = args.base.slice(retainedPrefixLength);
	const updates: TransactionOperation[] = [];
	for (let index = 0; index < retainedPrefixLength; index += 1) {
		const baseEntity = args.base[index];
		if (baseEntity === undefined) continue;
		const repair = repairs.get(baseEntity.id);
		if (repair !== undefined && Object.keys(repair.patch).length > 0) {
			updates.push(args.update(baseEntity, repair.patch));
		}
	}

	return { deletes, creates, updates, recreatedIds };
}

function planProjectCompensation(args: {
	readonly base: DraftContentSnapshot["project"];
	readonly candidate: DraftContentSnapshot["project"];
}): TransactionOperation | undefined {
	if (args.base === null && args.candidate === null) return undefined;
	if (
		args.base === null ||
		args.candidate === null ||
		args.base.id !== args.candidate.id
	) {
		throw new Error(
			"Draft Project creation, deletion, or identity changes cannot be compensated",
		);
	}
	const patch: ProjectPatch = {};
	for (const key of PROJECT_PATCH_KEYS) {
		if (!sameDraftData(args.base[key], args.candidate[key])) {
			(patch as Record<string, unknown>)[key] = args.base[key];
		}
	}
	if (Object.keys(patch).length === 0) {
		if (sameDraftData(args.base, args.candidate)) return undefined;
		throw new Error(
			"Draft changed non-patchable Project metadata and cannot be compensated",
		);
	}
	const restored = {
		...args.candidate,
		...patch,
		id: args.candidate.id,
	};
	if (!sameDraftData(restored, args.base)) {
		throw new Error("Project inverse does not restore the exact base Project");
	}
	return {
		kind: "update-project",
		projectId: args.base.id,
		patch,
	};
}

/**
 * Plan the smallest suffix-based compensation expressible by T1's frozen
 * operation union. Entities that can be restored by update stay in place;
 * only the first entity that must be inserted, reordered, or have an own
 * property removed and the ordered suffix after it are recreated. The planner
 * makes a bounded number of linear collection passes and never expands an
 * ordinary field update into a document-sized create/delete batch.
 */
export function planDraftCompensatingOperations(args: {
	readonly base: DraftContentSnapshot;
	readonly candidate: DraftContentSnapshot;
	readonly operations: readonly TransactionOperation[];
}): readonly TransactionOperation[] {
	const projectCompensation = planProjectCompensation({
		base: args.base.project,
		candidate: args.candidate.project,
	});
	const aliasRepairIds = collectDocumentAliasRepairIds(args);

	const trackPlan = planCollectionCompensation({
		base: args.base.tracks,
		candidate: args.candidate.tracks,
		canUpdate: true,
		aliasRepairIds,
		update: (track, patch) => ({
			kind: "update-track",
			trackId: track.id,
			patch: patch as never,
		}),
	});
	const assetPlan = planCollectionCompensation({
		base: args.base.assets,
		candidate: args.candidate.assets,
		canUpdate: false,
		aliasRepairIds,
		update: () => {
			throw new Error("Assets have no update operation");
		},
	});
	const clipPlan = planCollectionCompensation({
		base: args.base.clips,
		candidate: args.candidate.clips,
		canUpdate: true,
		aliasRepairIds,
		forceReplace: (clip) =>
			trackPlan.recreatedIds.has(clip.trackId) ||
			(clip.assetId !== undefined && assetPlan.recreatedIds.has(clip.assetId)),
		update: (clip, patch) => ({
			kind: "update-clip",
			clipId: clip.id,
			patch: patch as never,
		}),
	});
	const markerPlan = planCollectionCompensation({
		base: args.base.markers,
		candidate: args.candidate.markers,
		canUpdate: true,
		aliasRepairIds,
		update: (marker, patch) => ({
			kind: "update-marker",
			markerId: marker.id,
			patch: patch as never,
		}),
	});

	const planned: TransactionOperation[] = [
		...(projectCompensation === undefined ? [] : [projectCompensation]),
		...trackPlan.updates,
		...clipPlan.updates,
		...markerPlan.updates,
		...clipPlan.deletes.map(
			(clip): TransactionOperation => ({
				kind: "delete-clip",
				clipId: clip.id,
			}),
		),
		...trackPlan.deletes.map(
			(track): TransactionOperation => ({
				kind: "delete-track",
				trackId: track.id,
			}),
		),
		...assetPlan.deletes.map(
			(asset): TransactionOperation => ({
				kind: "delete-asset",
				assetId: asset.id,
			}),
		),
		...markerPlan.deletes.map(
			(marker): TransactionOperation => ({
				kind: "delete-marker",
				markerId: marker.id,
			}),
		),
		...trackPlan.creates.map(
			(track): TransactionOperation => ({
				kind: "create-track",
				track,
			}),
		),
		...assetPlan.creates.map(
			(asset): TransactionOperation => ({
				kind: "create-asset",
				asset,
			}),
		),
		...clipPlan.creates.map(
			(clip): TransactionOperation => ({
				kind: "create-clip",
				clip,
			}),
		),
		...markerPlan.creates.map(
			(marker): TransactionOperation => ({
				kind: "create-marker",
				marker,
			}),
		),
	];

	// A non-empty forward batch may already be content-neutral. Replaying that
	// same accepted batch is then a non-empty, affected-entity-only compensation
	// which preserves the exact content again and remains policy-visible.
	return cloneDraftValue(planned.length === 0 ? args.operations : planned);
}

export function referencedDraftAssetIds(
	candidate: Pick<DraftContentSnapshot, "clips">,
): readonly AssetId[] {
	const ids = new Set<AssetId>();
	for (const clip of candidate.clips) {
		if (clip.assetId !== undefined) ids.add(clip.assetId);
	}
	return [...ids];
}
