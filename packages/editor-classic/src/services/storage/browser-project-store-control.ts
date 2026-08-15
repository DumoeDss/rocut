import type {
	ProjectStoreErrorCode,
	ProjectStoreErrorScope,
	ProjectStoreInspection,
	ProjectStoreOperation,
} from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";
import {
	cloneBrowserValue,
	throwIfBrowserStoreAborted,
} from "./browser-project-store-internals";

export interface BrowserMutationPause {
	readonly entered: Promise<void>;
	release(): void;
}

interface PendingPause {
	readonly operation: ProjectStoreOperation;
	readonly enter: () => void;
	readonly wait: Promise<void>;
}

interface PendingReadPause extends PendingPause {
	remainingDispatches: number;
}

type BrowserCascadeOperation = "remove-project" | "clear";

export class BrowserProjectStoreControl {
	private inspectionOverride: ProjectStoreInspection | null = null;
	private readonly failures: Array<{
		operation: ProjectStoreOperation;
		code: ProjectStoreErrorCode;
	}> = [];
	private readonly pauses: PendingPause[] = [];
	private readonly mediaAccessPauses: PendingPause[] = [];
	private readonly readPauses: PendingReadPause[] = [];
	private readonly cascadeFailures: Array<{
		operation: BrowserCascadeOperation;
		afterCompletedTargets: number;
		code: ProjectStoreErrorCode;
	}> = [];
	private readonly libraryClearFailures: Array<{
		namespace: string;
		afterDeletedKeys: number;
		code: ProjectStoreErrorCode;
	}> = [];
	private readonly allClearLibraryFailures: ProjectStoreErrorCode[] = [];
	private readonly postAllClearLibraryFailures: ProjectStoreErrorCode[] = [];

	setInspection(inspection: ProjectStoreInspection): void {
		this.inspectionOverride = cloneBrowserValue({
			value: inspection,
			operation: "inspect",
			scope: { kind: "store" },
		});
	}

	readInspection(): ProjectStoreInspection | null {
		return this.inspectionOverride
			? cloneBrowserValue({
					value: this.inspectionOverride,
					operation: "inspect",
					scope: { kind: "store" },
				})
			: null;
	}

	failNext(args: {
		operation: ProjectStoreOperation;
		code: ProjectStoreErrorCode;
	}): void {
		this.failures.push(args);
	}

	pauseNext(args: { operation: ProjectStoreOperation }): BrowserMutationPause {
		let enter!: () => void;
		const entered = new Promise<void>((resolve) => {
			enter = resolve;
		});
		let release!: () => void;
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.pauses.push({ operation: args.operation, enter, wait });
		return { entered, release };
	}

	pauseNextMediaAccess(args: {
		operation: ProjectStoreOperation;
	}): BrowserMutationPause {
		let enter!: () => void;
		const entered = new Promise<void>((resolve) => {
			enter = resolve;
		});
		let release!: () => void;
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.mediaAccessPauses.push({ operation: args.operation, enter, wait });
		return { entered, release };
	}

	async afterMediaOwnerRegistration(args: {
		operation: ProjectStoreOperation;
	}): Promise<void> {
		const pauseIndex = this.mediaAccessPauses.findIndex(
			(pause) => pause.operation === args.operation,
		);
		if (pauseIndex < 0) return;
		const [pause] = this.mediaAccessPauses.splice(pauseIndex, 1);
		pause.enter();
		await pause.wait;
	}

	pauseNextRead(args: {
		operation: ProjectStoreOperation;
		afterDispatches?: number;
	}): BrowserMutationPause {
		const remainingDispatches = args.afterDispatches ?? 1;
		if (!Number.isInteger(remainingDispatches) || remainingDispatches < 1) {
			throw new Error("Read pause dispatch count must be a positive integer");
		}
		let enter!: () => void;
		const entered = new Promise<void>((resolve) => {
			enter = resolve;
		});
		let release!: () => void;
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.readPauses.push({
			operation: args.operation,
			remainingDispatches,
			enter,
			wait,
		});
		return { entered, release };
	}

	async afterReadDispatch(args: {
		operation: ProjectStoreOperation;
	}): Promise<void> {
		const pauseIndex = this.readPauses.findIndex(
			(pause) => pause.operation === args.operation,
		);
		if (pauseIndex < 0) return;
		const pause = this.readPauses[pauseIndex];
		pause.remainingDispatches -= 1;
		if (pause.remainingDispatches > 0) return;
		this.readPauses.splice(pauseIndex, 1);
		pause.enter();
		await pause.wait;
	}

	failCascadeCleanupAfter(args: {
		operation: BrowserCascadeOperation;
		afterCompletedTargets: number;
		code: ProjectStoreErrorCode;
	}): void {
		if (
			!Number.isInteger(args.afterCompletedTargets) ||
			args.afterCompletedTargets < 1
		) {
			throw new Error("Cascade cleanup fault must follow a completed target");
		}
		this.cascadeFailures.push(args);
	}

	failLibraryNamespaceClearAfter(args: {
		namespace: string;
		afterDeletedKeys: number;
		code: ProjectStoreErrorCode;
	}): void {
		if (!Number.isInteger(args.afterDeletedKeys) || args.afterDeletedKeys < 1) {
			throw new Error("Library clear fault must follow a deleted key");
		}
		this.libraryClearFailures.push(args);
	}

	failAllClearLibraryAfterProjectCommit(code: ProjectStoreErrorCode): void {
		this.allClearLibraryFailures.push(code);
	}

	failAfterAllClearLibraryCommit(code: ProjectStoreErrorCode): void {
		this.postAllClearLibraryFailures.push(code);
	}

	afterLibraryNamespaceDelete(args: {
		namespace: string;
		deletedKeys: number;
		scope: ProjectStoreErrorScope;
	}): void {
		const failureIndex = this.libraryClearFailures.findIndex(
			(failure) =>
				failure.namespace === args.namespace &&
				failure.afterDeletedKeys === args.deletedKeys,
		);
		if (failureIndex < 0) return;
		const [failure] = this.libraryClearFailures.splice(failureIndex, 1);
		throw new ProjectStoreError({
			code: failure.code,
			operation: "clear",
			scope: args.scope,
		});
	}

	beforeAllClearLibraryCommit(scope: ProjectStoreErrorScope): void {
		const code = this.allClearLibraryFailures.shift();
		if (!code) return;
		throw new ProjectStoreError({ code, operation: "clear", scope });
	}

	afterAllClearLibraryCommit(scope: ProjectStoreErrorScope): void {
		const code = this.postAllClearLibraryFailures.shift();
		if (!code) return;
		throw new ProjectStoreError({ code, operation: "clear", scope });
	}

	afterCascadeCleanupTarget(args: {
		operation: BrowserCascadeOperation;
		completedTargets: number;
		scope: ProjectStoreErrorScope;
	}): void {
		const failureIndex = this.cascadeFailures.findIndex(
			(failure) =>
				failure.operation === args.operation &&
				failure.afterCompletedTargets === args.completedTargets,
		);
		if (failureIndex < 0) return;
		const [failure] = this.cascadeFailures.splice(failureIndex, 1);
		throw new ProjectStoreError({
			code: failure.code,
			operation: failure.operation,
			scope: args.scope,
		});
	}

	async beforeCommit(args: {
		operation: ProjectStoreOperation;
		scope: ProjectStoreErrorScope;
		signal?: AbortSignal;
	}): Promise<void> {
		throwIfBrowserStoreAborted(args);
		const failureIndex = this.failures.findIndex(
			(failure) => failure.operation === args.operation,
		);
		if (failureIndex >= 0) {
			const [failure] = this.failures.splice(failureIndex, 1);
			throw new ProjectStoreError({
				code: failure.code,
				operation: args.operation,
				scope: args.scope,
			});
		}
		const pauseIndex = this.pauses.findIndex(
			(pause) => pause.operation === args.operation,
		);
		if (pauseIndex < 0) return;
		const [pause] = this.pauses.splice(pauseIndex, 1);
		pause.enter();
		await pause.wait;
		throwIfBrowserStoreAborted(args);
	}
}

export type BrowserMutationIdentity =
	| { readonly kind: "project-record"; readonly projectId: string }
	| {
			readonly kind: "attachment";
			readonly projectId: string;
			readonly key: string;
	  }
	| { readonly kind: "project-tree"; readonly projectId: string }
	| { readonly kind: "all-projects" }
	| {
			readonly kind: "library-record";
			readonly namespace: string;
			readonly key: string;
	  }
	| { readonly kind: "library-namespace"; readonly namespace: string }
	| { readonly kind: "all" };

interface PendingMutation {
	readonly identity: BrowserMutationIdentity;
	readonly completion: Promise<void>;
}

type ProjectMutationIdentity = Extract<
	BrowserMutationIdentity,
	{ kind: "project-record" | "attachment" | "project-tree" | "all-projects" }
>;

type LibraryMutationIdentity = Extract<
	BrowserMutationIdentity,
	{ kind: "library-record" | "library-namespace" }
>;

function isProjectMutation(
	identity: BrowserMutationIdentity,
): identity is ProjectMutationIdentity {
	return (
		identity.kind === "project-record" ||
		identity.kind === "attachment" ||
		identity.kind === "project-tree" ||
		identity.kind === "all-projects"
	);
}

function isLibraryMutation(
	identity: BrowserMutationIdentity,
): identity is LibraryMutationIdentity {
	return (
		identity.kind === "library-record" || identity.kind === "library-namespace"
	);
}

function conflicts(args: {
	left: BrowserMutationIdentity;
	right: BrowserMutationIdentity;
}): boolean {
	const { left, right } = args;
	if (left.kind === "all" || right.kind === "all") return true;
	if (left.kind === "all-projects" || right.kind === "all-projects") {
		return isProjectMutation(left) && isProjectMutation(right);
	}
	if (left.kind === "project-tree") {
		return (
			(right.kind === "project-record" ||
				right.kind === "attachment" ||
				right.kind === "project-tree") &&
			right.projectId === left.projectId
		);
	}
	if (right.kind === "project-tree")
		return conflicts({ left: right, right: left });
	if (left.kind === "project-record" && right.kind === "project-record") {
		return left.projectId === right.projectId;
	}
	if (left.kind === "attachment" && right.kind === "attachment") {
		return left.projectId === right.projectId && left.key === right.key;
	}
	if (left.kind === "library-namespace") {
		return isLibraryMutation(right) && left.namespace === right.namespace;
	}
	if (right.kind === "library-namespace")
		return conflicts({ left: right, right: left });
	return (
		left.kind === "library-record" &&
		right.kind === "library-record" &&
		left.namespace === right.namespace &&
		left.key === right.key
	);
}

export class BrowserMutationQueue {
	private readonly pending = new Set<PendingMutation>();

	async run<Result>(args: {
		identity: BrowserMutationIdentity;
		operation(): Promise<Result>;
	}): Promise<Result> {
		const blockers = [...this.pending]
			.filter((pending) =>
				conflicts({ left: pending.identity, right: args.identity }),
			)
			.map((pending) => pending.completion);
		let complete!: () => void;
		const completion = new Promise<void>((resolve) => {
			complete = resolve;
		});
		const pending = { identity: args.identity, completion };
		this.pending.add(pending);
		try {
			await Promise.all(blockers);
			return await args.operation();
		} finally {
			this.pending.delete(pending);
			complete();
		}
	}
}

const mutationQueueReferences = new Map<
	string,
	WeakRef<BrowserMutationQueue>
>();
const mutationQueueFinalizer = new FinalizationRegistry<string>(
	(identityKey) => {
		if (!mutationQueueReferences.get(identityKey)?.deref()) {
			mutationQueueReferences.delete(identityKey);
		}
	},
);

export function browserMutationQueueForIdentity(
	identityKey: string,
): BrowserMutationQueue {
	const existing = mutationQueueReferences.get(identityKey)?.deref();
	if (existing) return existing;
	const queue = new BrowserMutationQueue();
	mutationQueueReferences.set(identityKey, new WeakRef(queue));
	mutationQueueFinalizer.register(queue, identityKey, queue);
	return queue;
}

export function resetBrowserMutationQueuesForTests(): void {
	mutationQueueReferences.clear();
}
