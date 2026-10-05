import { describe, expect, test } from "bun:test";
import type { DraftReviewPort as TransportPort } from "@opencut/editor-ports/host";
import {
	createValidatedDraftReviewPort,
	isDraftReviewDocument,
	isDraftReviewItem,
} from "../review-port";

const item = () => ({
	id: "draft-a",
	state: "editing",
	approvalMode: "manual" as const,
	baseRevision: 7,
	acceptedCallCount: 1,
	acceptedOperationCount: 1,
});
const content = () => ({
	project: null,
	tracks: [],
	clips: [],
	assets: [],
	markers: [],
	motionTextSequences: [],
	revision: 7,
});
const document = () => ({
	snapshot: { ...item(), base: content(), working: content() },
	review: {
		entries: [
			{
				kind: "update-clip",
				callIndex: 0,
				operationIndex: 0,
				affectedEntityIds: ["clip-a"],
			},
		],
		affectedEntityIds: ["clip-a"],
		counts: { calls: 1, operations: 1, byKind: { "update-clip": 1 } },
	},
	token: "a".repeat(64),
});

describe("domain refinement of dependency-free draft transport", () => {
	test("passes snapshot identity and exact review token to the owning adapter", async () => {
		const value = document();
		const calls: unknown[] = [];
		const transport: TransportPort = {
			async list() {
				calls.push("list");
				return [item()];
			},
			async read(id) {
				calls.push(id);
				return value;
			},
			async decide(args) {
				calls.push(args);
			},
		};
		const port = createValidatedDraftReviewPort(transport);
		expect(await port.list()).toEqual([item()]);
		expect(await port.read("draft-a")).toBe(value);
		await port.decide({
			id: "draft-a",
			token: value.token,
			decision: "approve",
		});
		expect(calls).toEqual([
			"list",
			"draft-a",
			{ id: "draft-a", token: value.token, decision: "approve" },
		]);
	});
	test("accepts all canonical states and a pre-motion-text snapshot", () => {
		for (const state of [
			"editing",
			"applying",
			"applied",
			"rejected",
			"conflicted",
		])
			expect(isDraftReviewItem({ ...item(), state })).toBe(true);
		const value = document();
		Reflect.deleteProperty(value.snapshot.base, "motionTextSequences");
		expect(isDraftReviewDocument(value)).toBe(true);
	});
	test("rejects unsupported lifecycle and malformed revision/count metadata", async () => {
		expect(isDraftReviewItem({ ...item(), approvalMode: "other" })).toBe(false);
		for (const patch of [
			{ state: "approved" },
			{ id: "" },
			{ baseRevision: -1 },
			{ acceptedOperationCount: 0.5 },
			{ acceptedCallCount: NaN },
		]) {
			const invalid = { ...item(), ...patch };
			expect(isDraftReviewItem(invalid)).toBe(false);
			const port = createValidatedDraftReviewPort({
				async list() {
					return [invalid];
				},
				async read() {
					return document();
				},
				async decide() {
					throw Error("must not decide");
				},
			});
			await expect(port.list()).rejects.toThrow(
				"does not support draft review",
			);
		}
	});
	test("rejects wrong identity, changed token shape and malformed content", async () => {
		const valid = document();
		const invalids = [
			{ ...valid, token: "stale" },
			{ ...valid, snapshot: { ...valid.snapshot, base: null } },
			{
				...valid,
				snapshot: { ...valid.snapshot, working: { ...content(), clips: null } },
			},
			{ ...valid, review: { entries: [null] } },
			{ ...valid, snapshot: { ...valid.snapshot, id: "another-draft" } },
		];
		for (const invalid of invalids) {
			const port = createValidatedDraftReviewPort({
				async list() {
					return [];
				},
				async read() {
					return invalid;
				},
				async decide() {
					throw Error("must not decide");
				},
			});
			await expect(port.read("draft-a")).rejects.toThrow(
				"Invalid draft review",
			);
		}
	});
	test("does not swallow host conflicts or reinterpret approval decisions", async () => {
		const conflict = new Error("draft-review-changed");
		const decisions: unknown[] = [];
		const port = createValidatedDraftReviewPort({
			async list() {
				return [];
			},
			async read() {
				throw conflict;
			},
			async decide(args) {
				decisions.push(args);
				throw conflict;
			},
		});
		await expect(port.read("draft-a")).rejects.toBe(conflict);
		const decision = {
			id: "draft-a",
			token: "b".repeat(64),
			decision: "reject" as const,
		};
		await expect(port.decide(decision)).rejects.toBe(conflict);
		expect(decisions).toEqual([decision]);
	});
});
