export type CaptionProcessingState =
	| { status: "idle"; error: string | null; warnings: string[] }
	| { status: "processing"; step: string; cancellable: boolean };

export const CAPTION_IDLE_STATE: CaptionProcessingState = {
	status: "idle",
	error: null,
	warnings: [],
};

// Own only the UI operation lifetime. Parsing, inference and insertion remain
// with their existing services; a cancelled file read may finish but not publish.
export function createCaptionTaskController({
	onChange,
	captureActivity,
}: {
	onChange: (state: CaptionProcessingState) => void;
	captureActivity: () => () => boolean;
}) {
	let active: { cancel?: () => void; cancellable: boolean } | null = null;
	let disposed = false;
	function invalidate() {
		const previous = active;
		active = null;
		try {
			if (previous?.cancellable) previous.cancel?.();
			if (!disposed) onChange(CAPTION_IDLE_STATE);
		} catch (error) {
			if (!disposed)
				onChange({
					status: "idle",
					error: error instanceof Error ? error.message : "Cancellation failed",
					warnings: [],
				});
		}
	}
	return {
		begin({ step, onCancel }: { step: string; onCancel?: () => void }) {
			if (disposed || active) return null;
			const activityCurrent = captureActivity();
			if (!activityCurrent()) return null;
			const task = { cancel: onCancel, cancellable: true };
			active = task;
			const isCurrent = () => !disposed && active === task && activityCurrent();
			const finish = (state: CaptionProcessingState) => {
				if (!isCurrent()) return;
				active = null;
				onChange(state);
			};
			onChange({ status: "processing", step, cancellable: true });
			return {
				isCurrent,
				updateStep: ({ step: next }: { step: string }) => {
					if (isCurrent())
						onChange({
							status: "processing",
							step: next,
							cancellable: task.cancellable,
						});
				},
				beginCommit() {
					if (!isCurrent()) return false;
					// The command engine owns atomic persistence from this point.
					// Cancellation cannot retract an already submitted transaction.
					task.cancellable = false;
					onChange({
						status: "processing",
						step: "Saving captions...",
						cancellable: false,
					});
					return true;
				},
				succeed: ({ warnings = [] }: { warnings?: string[] } = {}) =>
					finish({ status: "idle", error: null, warnings }),
				fail: ({ error }: { error: string }) =>
					finish({ status: "idle", error, warnings: [] }),
			};
		},
		cancel: () => {
			if (active?.cancellable) invalidate();
		},
		invalidate,
		dispose() {
			disposed = true;
			invalidate();
		},
	};
}
