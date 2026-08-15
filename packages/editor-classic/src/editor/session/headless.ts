import type { EditorHost } from "@opencut/editor-ports/host";
import { resolveEditorHost } from "@opencut/editor-ports/host";
import type {
	ProjectId,
	SessionDiagnostics,
	SessionEvent,
	SessionId,
} from "@opencut/editor-ports";
import { SessionPersistenceCoordinator } from "../persistence";
import { runStoreMigrationOnce } from "./migration-gate";

export type HeadlessProject = NonNullable<
	Awaited<ReturnType<SessionPersistenceCoordinator["loadProject"]>>
>;

export interface HeadlessEditorSession {
	readonly id: SessionId;
	readonly projectId: ProjectId;
	load(args?: { signal?: AbortSignal }): Promise<HeadlessProject | null>;
	save(args: { project: HeadlessProject; signal?: AbortSignal }): Promise<void>;
	dispose(): Promise<void>;
}

export async function createHeadlessEditorSession(args: {
	host: EditorHost;
}): Promise<HeadlessEditorSession> {
	const host = resolveEditorHost({ host: args.host });
	const id: SessionId = host.ids.next({ scope: "session" });
	const projectId: ProjectId = host.projectId;
	const diagnosticListeners = new Set<(event: SessionEvent) => void>();
	const diagnostics: SessionDiagnostics = {
		log: ({ record }) => host.diagnostics.log({ record }),
		event: ({ event }) => {
			host.diagnostics.event({ sessionId: id, event });
			diagnosticListeners.forEach((listener) => listener(event));
		},
		subscribe: (listener) => {
			diagnosticListeners.add(listener);
			return () => diagnosticListeners.delete(listener);
		},
	};

	await runStoreMigrationOnce({
		host,
		diagnostics,
		onProgress: () => {},
	});

	const persistence = new SessionPersistenceCoordinator(host.store);
	let admissionOpen = true;
	let operationTail: Promise<void> = Promise.resolve();
	let disposalRun: Promise<void> | null = null;

	function admit<Result>(args: {
		operation: string;
		run: () => Promise<Result>;
	}) {
		if (!admissionOpen) {
			return Promise.reject(
				new Error(
					`Cannot ${args.operation} disposed headless session ${id}. Create a new owner instead.`,
				),
			);
		}
		const result = operationTail.then(args.run, args.run);
		operationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	const session: HeadlessEditorSession = {
		id,
		projectId,
		load: (loadArgs = {}) =>
			admit({
				operation: "load from",
				run: () =>
					persistence.loadProject({
						id: projectId,
						signal: loadArgs.signal,
					}),
			}),
		save: (saveArgs) =>
			admit({
				operation: "save to",
				run: async () => {
					if (saveArgs.project.metadata.id !== projectId) {
						throw new Error(
							`Cannot save project id ${saveArgs.project.metadata.id} through headless owner for ${projectId}.`,
						);
					}
					await persistence.saveProject({
						project: saveArgs.project,
						signal: saveArgs.signal,
					});
				},
			}),
		dispose: () => {
			if (disposalRun) return disposalRun;
			admissionOpen = false;
			const finish = () => {
				persistence.destroy();
				diagnosticListeners.clear();
			};
			disposalRun = operationTail.then(finish, finish);
			return disposalRun;
		},
	};

	return session;
}
