import type {
	ProjectAttachment,
	ProjectRecord,
	ProjectStore,
} from "@opencut/editor-ports";
import { editorForSession } from "@/editor/runtime/session-core-owner";
import { prepareWasmRuntimeProviders } from "@/editor/runtime/wasm-runtime-providers";
import { createEditorSession, type EditorSession } from "@/editor/session";
import {
	C6_DURABLE_REOPEN_BASE_COMMIT,
	captureDurableBrowserStoreAttribution,
	evaluateDurableReopenProof,
	type DurableReopenProofResult,
} from "./c6-durable-reopen";
import {
	type DisposalCycleObservation,
	type DisposalOracleClass,
} from "./disposal-oracle";
import type { DisposalReport } from "./resources";

const DURABLE_PROJECT_NAME = "Scenario 52 known edit";
const DURABLE_ATTACHMENT_KEY = "scenario-52-attachment";
const DURABLE_ATTACHMENT_DIGEST =
	"bdc3eaacc133fc08118f8e69a969417403735f8441000061d3018bb02fdc1ea4";
const DURABLE_ATTACHMENT_BYTES = [
	0, 1, 2, 3, 17, 31, 63, 127, 128, 129, 200, 254, 255, 42, 99, 7, 211, 34, 55,
	89, 144, 233, 5, 8, 13, 21, 34, 55, 89, 144, 233, 255,
] as const;
const PROJECT_PRIVATE_SENTINEL = {
	proof: "durable-reopen",
	version: 52,
	nested: {
		provider: "scenario-52",
		topologyJournal: [
			{ epoch: 1, state: "committed" },
			{ epoch: 2, state: "reopened" },
		],
		opaque: ["kept", 52, { enabled: true }],
	},
} as const;
const INITIAL_ATTACHMENT_METADATA = {
	id: DURABLE_ATTACHMENT_KEY,
	name: "Scenario 52 initial attachment",
	mediaType: "application/octet-stream",
	providerPrivateAttachment: {
		proof: "durable-reopen",
		nested: { opaque: [5, 2, { retained: true }] },
	},
	topologyJournal: { generation: 52, state: "durable" },
} as const;
const EXPECTED_ATTACHMENT_METADATA = {
	...INITIAL_ATTACHMENT_METADATA,
	name: "Scenario 52 known attachment edit",
} as const;

export interface DurableReopenPreparation {
	readonly session: EditorSession;
	readonly editor: ReturnType<typeof editorForSession>;
}

export interface RunDurableReopenBrowserProofArgs {
	readonly buildMarker: string;
	readonly target: HTMLDivElement;
	readonly active: Set<EditorSession>;
	readonly isDurableBrowserStore: (store: ProjectStore) => boolean;
	readonly runFirstCycle: (
		prepare: (args: DurableReopenPreparation) => Promise<void>,
	) => Promise<DisposalCycleObservation>;
}

interface FirstDurableSeed {
	readonly session: EditorSession;
	readonly store: ProjectStore;
	readonly projectId: string;
}

interface FirstDurableSnapshot extends FirstDurableSeed {
	readonly projectRecord: ProjectRecord;
	readonly projectDigest: string;
	readonly attachment: ProjectAttachment;
	readonly attachmentDigest: string;
}

interface BrowserDiagnosticsCapture {
	readonly consoleErrors: string[];
	readonly pageErrors: string[];
	stop(): void;
}

function isRecord(value: unknown): value is object {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytes(): ArrayBuffer {
	return new Uint8Array(DURABLE_ATTACHMENT_BYTES).buffer;
}

function bytesEqual({
	left,
	right,
}: {
	left: ArrayBuffer;
	right: ArrayBuffer;
}): boolean {
	const leftBytes = new Uint8Array(left);
	const rightBytes = new Uint8Array(right);
	return (
		leftBytes.byteLength === rightBytes.byteLength &&
		leftBytes.every((value, index) => value === rightBytes[index])
	);
}

function bytesHex(value: ArrayBuffer | ArrayBufferView): string {
	const source =
		value instanceof ArrayBuffer
			? new Uint8Array(value)
			: new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	return [...source].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function stableSerialize({
	value,
	seen = new Set<object>(),
}: {
	value: unknown;
	seen?: Set<object>;
}): string {
	if (value === null) return "null";
	switch (typeof value) {
		case "undefined":
			return "undefined";
		case "boolean":
			return `boolean:${value}`;
		case "number":
			return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
		case "bigint":
			return `bigint:${value.toString()}`;
		case "string":
			return `string:${JSON.stringify(value)}`;
		case "symbol":
			return `symbol:${String(value.description)}`;
		case "function":
			return `function:${value.name}`;
	}
	if (value instanceof Date) return `date:${value.toISOString()}`;
	if (value instanceof ArrayBuffer) return `array-buffer:${bytesHex(value)}`;
	if (ArrayBuffer.isView(value)) {
		return `${value.constructor.name}:${bytesHex(value)}`;
	}
	if (seen.has(value))
		throw new Error("Durable proof encountered cyclic data.");
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return `array:[${value
				.map((entry) => stableSerialize({ value: entry, seen }))
				.join(",")}]`;
		}
		if (value instanceof Map) {
			const entries = [...value.entries()]
				.map(
					([key, entry]) =>
						`${stableSerialize({ value: key, seen })}=>${stableSerialize({ value: entry, seen })}`,
				)
				.sort();
			return `map:{${entries.join(",")}}`;
		}
		if (value instanceof Set) {
			const entries = [...value.values()]
				.map((entry) => stableSerialize({ value: entry, seen }))
				.sort();
			return `set:{${entries.join(",")}}`;
		}
		const entries = Object.keys(value)
			.sort()
			.map(
				(key) =>
					`${JSON.stringify(key)}:${stableSerialize({ value: Reflect.get(value, key), seen })}`,
			);
		return `object:{${entries.join(",")}}`;
	} finally {
		seen.delete(value);
	}
}

function stableEqual({
	left,
	right,
}: {
	left: unknown;
	right: unknown;
}): boolean {
	return stableSerialize({ value: left }) === stableSerialize({ value: right });
}

async function digest(value: ArrayBuffer): Promise<string> {
	const result = await crypto.subtle.digest("SHA-256", value.slice(0));
	return bytesHex(result);
}

async function digestOpaque(value: unknown): Promise<string> {
	return digest(new TextEncoder().encode(stableSerialize({ value })).buffer);
}

function formatDiagnostic(value: unknown): string {
	if (value instanceof Error) return `${value.name}: ${value.message}`;
	if (typeof value === "string") return value;
	try {
		return stableSerialize({ value });
	} catch {
		return String(value);
	}
}

function captureBrowserDiagnostics(): BrowserDiagnosticsCapture {
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	const originalConsoleError = console.error;
	const onPageError = (event: ErrorEvent) => {
		pageErrors.push(
			event.error
				? formatDiagnostic(event.error)
				: `${event.message} (${event.filename}:${event.lineno}:${event.colno})`,
		);
	};
	const onUnhandledRejection = (event: PromiseRejectionEvent) => {
		pageErrors.push(`unhandled rejection: ${formatDiagnostic(event.reason)}`);
	};
	console.error = (...values: unknown[]) => {
		consoleErrors.push(values.map(formatDiagnostic).join(" "));
		originalConsoleError(...values);
	};
	window.addEventListener("error", onPageError);
	window.addEventListener("unhandledrejection", onUnhandledRejection);
	return {
		consoleErrors,
		pageErrors,
		stop: () => {
			console.error = originalConsoleError;
			window.removeEventListener("error", onPageError);
			window.removeEventListener("unhandledrejection", onUnhandledRejection);
		},
	};
}

function requireFirstSeed(
	value: FirstDurableSeed | undefined,
): FirstDurableSeed {
	if (!value) {
		throw new Error("The first durable session did not publish its seed.");
	}
	return value;
}

function privateProjectSentinel(record: ProjectRecord): unknown {
	return isRecord(record.data)
		? Reflect.get(record.data, "providerPrivateScenario52")
		: undefined;
}

function residuals(
	report: DisposalReport,
): Record<DisposalOracleClass, number> {
	const residual = (resourceClass: DisposalOracleClass) =>
		Math.max(0, report[resourceClass].created - report[resourceClass].released);
	return {
		timer: residual("timer"),
		worker: residual("worker"),
		audioContext: residual("audioContext"),
		objectUrl: residual("objectUrl"),
		gpuResource: residual("gpuResource"),
	};
}

function hostKind(): "vite" | "next" {
	return window.location.pathname.startsWith("/c6-disposal") ? "next" : "vite";
}

export async function runDurableReopenBrowserProof({
	buildMarker,
	target,
	active,
	isDurableBrowserStore,
	runFirstCycle,
}: RunDurableReopenBrowserProofArgs): Promise<DurableReopenProofResult> {
	const diagnostics = captureBrowserDiagnostics();
	let firstSeed: FirstDurableSeed | undefined;
	let secondSession: EditorSession | null = null;
	let secondDisposed = false;
	let secondRuntime: Awaited<
		ReturnType<typeof prepareWasmRuntimeProviders>
	> | null = null;
	try {
		const firstCycle = await runFirstCycle(async ({ session, editor }) => {
			const store = session.host.store;
			const createdProjectId = await editor.project.createNewProject({
				name: "Scenario 52 initial project",
			});
			const createdProject = await editor.persistence.loadProject({
				id: createdProjectId,
			});
			if (!createdProject) {
				throw new Error("The first session did not create a valid project.");
			}
			const projectId = session.projectId;
			await editor.persistence.saveProject({
				project: {
					...createdProject,
					metadata: {
						...createdProject.metadata,
						id: projectId,
						name: "Scenario 52 durable Host project",
						updatedAt: new Date("2026-08-04T00:00:51.000Z"),
					},
				},
			});
			const initialRecord = await store.load({ id: projectId });
			const summary = (await store.list()).find(
				(candidate) => candidate.id === projectId,
			);
			if (!initialRecord || !summary || !isRecord(initialRecord.data)) {
				throw new Error("The first session did not create a durable project.");
			}
			await store.save({
				record: {
					...initialRecord,
					data: {
						...initialRecord.data,
						providerPrivateScenario52: PROJECT_PRIVATE_SENTINEL,
					},
				},
				summary,
			});

			const project = await editor.persistence.loadProject({ id: projectId });
			if (!project) {
				throw new Error("The first coordinator could not reload its project.");
			}
			project.metadata.name = DURABLE_PROJECT_NAME;
			project.metadata.updatedAt = new Date("2026-08-04T00:00:52.000Z");
			await editor.persistence.saveProject({ project });
			const knownProjectReload = await editor.persistence.loadProject({
				id: projectId,
			});
			if (knownProjectReload?.metadata.name !== DURABLE_PROJECT_NAME) {
				throw new Error("The first coordinator did not retain its known edit.");
			}

			await store.saveAttachment({
				projectId,
				key: DURABLE_ATTACHMENT_KEY,
				metadata: INITIAL_ATTACHMENT_METADATA,
				body: bytes(),
			});
			const attachment = await editor.persistence.loadAttachment({
				projectId,
				key: DURABLE_ATTACHMENT_KEY,
				decodeMetadata: (value: unknown) => ({
					id: isRecord(value) ? Reflect.get(value, "id") : undefined,
					name: isRecord(value) ? Reflect.get(value, "name") : undefined,
					mediaType: isRecord(value)
						? Reflect.get(value, "mediaType")
						: undefined,
				}),
			});
			if (!attachment) {
				throw new Error("The first coordinator could not load its attachment.");
			}
			await editor.persistence.saveAttachment({
				projectId,
				key: DURABLE_ATTACHMENT_KEY,
				metadata: {
					...attachment.metadata,
					name: EXPECTED_ATTACHMENT_METADATA.name,
				},
				body: attachment.body,
			});

			firstSeed = {
				session,
				store,
				projectId,
			};
		});
		const seed = requireFirstSeed(firstSeed);
		const firstProjectRecord = await seed.store.load({ id: seed.projectId });
		const firstAttachment = await seed.store.loadAttachment({
			projectId: seed.projectId,
			key: DURABLE_ATTACHMENT_KEY,
		});
		if (!firstProjectRecord || !firstAttachment) {
			throw new Error(
				"The disposed first session's public store lost durable values.",
			);
		}
		const first: FirstDurableSnapshot = {
			...seed,
			projectRecord: firstProjectRecord,
			projectDigest: await digestOpaque(firstProjectRecord),
			attachment: firstAttachment,
			attachmentDigest: await digest(firstAttachment.body),
		};
		const firstRemoved = !active.has(first.session);

		const secondHost = first.session.host;
		secondRuntime = await prepareWasmRuntimeProviders();
		secondSession = await createEditorSession({
			host: secondHost,
			runtimeGraphics: secondRuntime.runtimeGraphics,
			runtimeGpu: secondRuntime.runtimeGpu,
		});
		active.add(secondSession);
		const secondRoot = secondSession.mount({ target });
		await secondRoot.ready;
		const secondEditor = editorForSession(secondSession);
		const reopenedProject = await secondEditor.persistence.loadProject({
			id: first.projectId,
		});
		const reopenedRecord = await secondSession.host.store.load({
			id: first.projectId,
		});
		const coordinatorAttachment = await secondEditor.persistence.loadAttachment(
			{
				projectId: first.projectId,
				key: DURABLE_ATTACHMENT_KEY,
			},
		);
		const reopenedAttachment = await secondSession.host.store.loadAttachment({
			projectId: first.projectId,
			key: DURABLE_ATTACHMENT_KEY,
		});
		if (!reopenedRecord || !coordinatorAttachment || !reopenedAttachment) {
			throw new Error(
				"The second public session could not reopen durable data.",
			);
		}
		const reopenedProjectDigest = await digestOpaque(reopenedRecord);
		const reopenedAttachmentDigest = await digest(reopenedAttachment.body);
		const secondReport = await secondSession.dispose();
		secondDisposed = true;
		const liveGpuHandlesAfterDispose = [
			...secondRuntime.runtimeGpu.liveHandles(),
		];
		await secondRuntime.dispose();
		secondRuntime = null;
		active.delete(secondSession);
		const secondRemoved = !active.has(secondSession);
		const storeAttribution = captureDurableBrowserStoreAttribution({
			store: first.store,
			isDurableBrowserStore,
		});

		return evaluateDurableReopenProof({
			host: hostKind(),
			buildMarker,
			baseCommit: C6_DURABLE_REOPEN_BASE_COMMIT,
			pageBase: new URL(window.location.pathname, window.location.origin).href,
			browserProjectStore: {
				...storeAttribution,
				sameStore: secondSession.host.store === first.store,
			},
			project: {
				projectId: first.projectId,
				expectedName: DURABLE_PROJECT_NAME,
				reopenedName: reopenedProject?.metadata.name ?? null,
				firstRawDigest: first.projectDigest,
				reopenedRawDigest: reopenedProjectDigest,
				rawEqual: stableEqual({
					left: first.projectRecord,
					right: reopenedRecord,
				}),
				privateSentinelEqual:
					stableEqual({
						left: privateProjectSentinel(first.projectRecord),
						right: PROJECT_PRIVATE_SENTINEL,
					}) &&
					stableEqual({
						left: privateProjectSentinel(reopenedRecord),
						right: PROJECT_PRIVATE_SENTINEL,
					}),
			},
			attachment: {
				key: DURABLE_ATTACHMENT_KEY,
				expectedDigest: DURABLE_ATTACHMENT_DIGEST,
				firstDigest: first.attachmentDigest,
				reopenedDigest: reopenedAttachmentDigest,
				metadataEqual:
					stableEqual({
						left: first.attachment.metadata,
						right: EXPECTED_ATTACHMENT_METADATA,
					}) &&
					stableEqual({
						left: reopenedAttachment.metadata,
						right: EXPECTED_ATTACHMENT_METADATA,
					}) &&
					stableEqual({
						left: coordinatorAttachment.metadata,
						right: reopenedAttachment.metadata,
					}),
				bodyEqual:
					bytesEqual({ left: first.attachment.body, right: bytes() }) &&
					bytesEqual({ left: reopenedAttachment.body, right: bytes() }) &&
					bytesEqual({
						left: coordinatorAttachment.body,
						right: reopenedAttachment.body,
					}),
			},
			sessions: {
				first: first.session.id,
				second: secondSession.id,
				distinct: first.session.id !== secondSession.id,
				sameHost: secondSession.host === first.session.host,
				sameProjectId:
					first.session.projectId === first.projectId &&
					secondSession.projectId === first.projectId,
				firstRemoved,
				secondRemoved,
			},
			firstCycle,
			second: {
				residual: residuals(secondReport),
				liveGpuHandlesAfterDispose,
			},
			final: { activeSessions: active.size },
			consoleErrors: [...diagnostics.consoleErrors],
			pageErrors: [...diagnostics.pageErrors],
		});
	} finally {
		if (secondSession && !secondDisposed) {
			await secondSession.dispose().catch(() => {});
		}
		if (secondSession) active.delete(secondSession);
		if (secondRuntime) {
			await Promise.resolve(secondRuntime.dispose()).catch(() => {});
		}
		diagnostics.stop();
	}
}
