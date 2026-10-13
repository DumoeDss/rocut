import type {
	CompositionExportCommand,
	CompositionExportSource,
} from "./host-composition-export";
import type { HostExportOptions } from "./host-export-protocol";

type Start = Extract<
	CompositionExportCommand,
	{ command: "composition.export.start" }
>;
type RenderResult = {
	success: boolean;
	buffer?: ArrayBuffer;
	cancelled?: boolean;
	error?: string;
};

export function createCompositionExportController(deps: {
	isBusy(): boolean;
	setBusy(value: boolean): void;
	verify(command: Start): void;
	render(args: {
		source: CompositionExportSource;
		options: HostExportOptions;
		onProgress(args: { progress: number }): void;
		onCancel(): boolean;
	}): Promise<RenderResult>;
	transport: {
		progress(args: { scope: Start; progress: number }): Promise<boolean>;
		upload(args: { scope: Start; bytes: ArrayBuffer }): Promise<void>;
		failure(args: {
			scope: Start;
			error: string;
			terminated?: boolean;
		}): Promise<void>;
	};
}) {
	// Retained for the pane lifetime: reconnect replay must never render twice.
	const seen = new Map<string, string>();
	const running = new Map<string, { cancelled: boolean }>();
	const keyOf = (command: CompositionExportCommand) =>
		JSON.stringify([command.requestId, command.jobId]);
	async function run(command: Start) {
		const key = keyOf(command);
		const identity = JSON.stringify(command);
		if (seen.has(key)) {
			if (seen.get(key) !== identity) {
				const state = running.get(key);
				if (state) state.cancelled = true;
				await deps.transport.failure({
					scope: command,
					error: "composition-export-job-conflict",
				});
			}
			return;
		}
		if (seen.size >= 1024) {
			await deps.transport.failure({
				scope: command,
				error: "composition-export-pane-capacity-reached",
			});
			return;
		}
		seen.set(key, identity);
		if (deps.isBusy()) {
			await deps.transport.failure({
				scope: command,
				error: "this editor pane is already rendering another export",
			});
			return;
		}
		deps.setBusy(true);
		const state = { cancelled: false };
		running.set(key, state);
		let reports = Promise.resolve();
		try {
			// Private snapshot excludes caller mutation during asynchronous rendering.
			const sealed: Start = JSON.parse(identity);
			deps.verify(sealed);
			const result = await deps.render({
				source: sealed.source,
				options: sealed.options,
				onCancel: () => state.cancelled,
				onProgress: ({ progress }) => {
					reports = reports
						.then(async () => {
							if (await deps.transport.progress({ scope: sealed, progress }))
								state.cancelled = true;
						})
						.catch(() => {
							state.cancelled = true;
						});
				},
			});
			await reports;
			if (state.cancelled || result.cancelled) throw new Error("cancelled");
			if (!result.success || !result.buffer)
				throw new Error(result.error ?? "export failed");
			deps.verify(sealed);
			if (state.cancelled) throw new Error("cancelled");
			await deps.transport.upload({ scope: sealed, bytes: result.buffer });
		} catch (error) {
			await reports;
			await deps.transport.failure({
				scope: command,
				error:
					error instanceof Error ? error.message : "composition export failed",
				terminated: state.cancelled,
			});
		} finally {
			running.delete(key);
			deps.setBusy(false);
		}
	}
	return {
		handle(command: CompositionExportCommand) {
			if (command.command === "composition.export.cancel") {
				const state = running.get(keyOf(command));
				if (state) state.cancelled = true;
				return;
			}
			void run(command).catch(() => undefined);
		},
		disconnect() {
			for (const state of running.values()) state.cancelled = true;
		},
	};
}
