/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- History rebasing is an internal donor merge over recursively cloned opaque values. */
import { cloneOpaque } from "@/editor/persistence/opaque-value";
import type { OpenCutProjectDraft } from "./types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		!(value instanceof Date)
	);
}

function same(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (left instanceof Date && right instanceof Date) {
		return left.getTime() === right.getTime();
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		return (
			left.length === right.length &&
			left.every((value, index) => same(value, right[index]))
		);
	}
	if (isRecord(left) && isRecord(right)) {
		const leftKeys = Object.keys(left).sort();
		const rightKeys = Object.keys(right).sort();
		return (
			leftKeys.length === rightKeys.length &&
			leftKeys.every(
				(key, index) => key === rightKeys[index] && same(left[key], right[key]),
			)
		);
	}
	return false;
}

function hasId(value: unknown): value is UnknownRecord & { id: string } {
	return isRecord(value) && typeof value.id === "string";
}

function isEntityCollection(
	current: readonly unknown[],
	from: readonly unknown[],
	to: readonly unknown[],
): boolean {
	const values = [...current, ...from, ...to];
	return values.length > 0 && values.every(hasId);
}

function insertInTargetOrder(
	values: unknown[],
	entry: UnknownRecord & { id: string },
	target: readonly (UnknownRecord & { id: string })[],
): void {
	const targetIndex = target.findIndex(
		(candidate) => candidate.id === entry.id,
	);
	for (let index = targetIndex - 1; index >= 0; index -= 1) {
		const previousId = target[index]?.id;
		const previousIndex = values.findIndex(
			(candidate) => hasId(candidate) && candidate.id === previousId,
		);
		if (previousIndex >= 0) {
			values.splice(previousIndex + 1, 0, cloneOpaque(entry));
			return;
		}
	}
	for (let index = targetIndex + 1; index < target.length; index += 1) {
		const nextId = target[index]?.id;
		const nextIndex = values.findIndex(
			(candidate) => hasId(candidate) && candidate.id === nextId,
		);
		if (nextIndex >= 0) {
			values.splice(nextIndex, 0, cloneOpaque(entry));
			return;
		}
	}
	values.push(cloneOpaque(entry));
}

function rebaseEntityCollection(
	current: readonly unknown[],
	from: readonly unknown[],
	to: readonly unknown[],
): unknown[] {
	const currentEntities = current as readonly (UnknownRecord & {
		id: string;
	})[];
	const fromEntities = from as readonly (UnknownRecord & { id: string })[];
	const toEntities = to as readonly (UnknownRecord & { id: string })[];
	const fromById = new Map(fromEntities.map((entry) => [entry.id, entry]));
	const toById = new Map(toEntities.map((entry) => [entry.id, entry]));
	const result: unknown[] = [];

	for (const currentEntry of currentEntities) {
		const fromEntry = fromById.get(currentEntry.id);
		if (!fromEntry) {
			result.push(cloneOpaque(currentEntry));
			continue;
		}
		const toEntry = toById.get(currentEntry.id);
		if (!toEntry) continue;
		result.push(rebaseValue(currentEntry, fromEntry, toEntry));
	}

	for (const toEntry of toEntities) {
		if (
			result.some(
				(candidate) => hasId(candidate) && candidate.id === toEntry.id,
			)
		) {
			continue;
		}
		insertInTargetOrder(result, toEntry, toEntities);
	}
	return result;
}

function rebaseRecord(
	current: UnknownRecord,
	from: UnknownRecord,
	to: UnknownRecord,
): UnknownRecord {
	const result = cloneOpaque(current);
	const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
	for (const key of keys) {
		const fromHas = Object.prototype.hasOwnProperty.call(from, key);
		const toHas = Object.prototype.hasOwnProperty.call(to, key);
		if (fromHas && !toHas) {
			delete result[key];
			continue;
		}
		if (!toHas) continue;
		if (!fromHas) {
			result[key] = cloneOpaque(to[key]);
			continue;
		}
		if (same(from[key], to[key])) continue;
		result[key] = rebaseValue(
			Object.prototype.hasOwnProperty.call(current, key)
				? current[key]
				: from[key],
			from[key],
			to[key],
		);
	}
	return result;
}

function rebaseValue(current: unknown, from: unknown, to: unknown): unknown {
	if (same(from, to)) return cloneOpaque(current);
	if (Array.isArray(from) && Array.isArray(to)) {
		const currentArray = Array.isArray(current) ? current : from;
		if (isEntityCollection(currentArray, from, to)) {
			return rebaseEntityCollection(currentArray, from, to);
		}
		return cloneOpaque(to);
	}
	if (isRecord(from) && isRecord(to)) {
		return rebaseRecord(isRecord(current) ? current : from, from, to);
	}
	return cloneOpaque(to);
}

export function rebaseOpenCutHistoryDraft({
	current,
	from,
	to,
}: {
	current: OpenCutProjectDraft;
	from: OpenCutProjectDraft;
	to: OpenCutProjectDraft;
}): OpenCutProjectDraft {
	return rebaseValue(current, from, to) as OpenCutProjectDraft;
}
