import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { ExportJob } from "./host-export";

export type ManagedOutputJob = Omit<ExportJob, "options"> & {
	readonly options: { readonly format: "mp4" | "webm" | "png" };
};

/** Owns only files created for this upload; concurrent result reports coalesce. */
export function createExportOutputWriter<
	T extends ManagedOutputJob = ExportJob,
>({
	projectDir,
	now,
	noteActivity,
	validatePublication,
}: {
	readonly projectDir: string;
	readonly now: () => number;
	readonly noteActivity: () => void;
	readonly validatePublication?: (job: T) => Promise<void>;
}) {
	const pending = new Map<string, Promise<T>>();
	const canPublish = (job: T): boolean => {
		if (job.status !== "pending" && job.status !== "running") return false;
		if (!job.cancelRequested) return true;
		job.status = "cancelled";
		job.updatedAt = now();
		noteActivity();
		return false;
	};
	const publish = async (job: T, bytes: Uint8Array): Promise<T> => {
		if (!canPublish(job)) return job;
		const dir = path.join(projectDir, "exports");
		await mkdir(dir, { recursive: true });
		if (!canPublish(job)) return job;
		const file = path.join(dir, job.id + "." + job.options.format);
		const staging = path.join(
			dir,
			job.id + "." + randomBytes(8).toString("hex") + ".pending",
		);
		// Exclusive staging gives cleanup an exact owned target, even on write failure.
		const handle = await open(staging, "wx");
		let published = false;
		try {
			try {
				await handle.writeFile(bytes);
			} finally {
				await handle.close();
			}
			await validatePublication?.(job);
			if (!canPublish(job)) return job;
			await rename(staging, file);
			published = true;
			await validatePublication?.(job);
			// Cancellation/failure can arrive at any await, including rename itself.
			if (!canPublish(job)) return job;
			job.status = "completed";
			job.progress = 1;
			job.outputPath = file;
			job.updatedAt = now();
			noteActivity();
			return job;
		} finally {
			if (!published) await rm(staging, { force: true });
			else if (job.status !== "completed") await rm(file, { force: true });
		}
	};
	return (job: T, bytes: Uint8Array): Promise<T> => {
		const active = pending.get(job.id);
		if (active) return active;
		const writing = publish(job, bytes).finally(() => pending.delete(job.id));
		pending.set(job.id, writing);
		return writing;
	};
}
