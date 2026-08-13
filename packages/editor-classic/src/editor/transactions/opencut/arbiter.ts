export class ProjectMutationArbiter {
	private readonly pending = new Map<string, Promise<void>>();

	run<Result>({
		projectId,
		operation,
	}: {
		projectId: string;
		operation: () => Promise<Result>;
	}): Promise<Result> {
		const predecessor = this.pending.get(projectId);
		const result = (predecessor ?? Promise.resolve())
			.catch(() => undefined)
			.then(operation);
		const settled = result.then(
			() => undefined,
			() => undefined,
		);
		this.pending.set(projectId, settled);
		void settled.then(() => {
			if (this.pending.get(projectId) === settled) {
				this.pending.delete(projectId);
			}
		});
		return result;
	}
}
