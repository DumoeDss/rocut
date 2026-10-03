import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { ExportJob } from "./host-export";

/** Owns only files created for this upload; concurrent result reports coalesce. */
export function createExportOutputWriter({
	projectDir,
	now,
	noteActivity,
}: {
	readonly projectDir: string;
	readonly now: () => number;
	readonly noteActivity: () => void;
}) {
	const pending = new Map<string, Promise<ExportJob>>();
	const canPublish = (job: ExportJob): boolean => {
		if (job.status !== "pending" && job.status !== "running") return false;
		if (!job.cancelRequested) return true;
		job.status = "cancelled";
		job.updatedAt = now();
		noteActivity();
		return false;
	};
	const publish = async (
		job: ExportJob,
		bytes: Uint8Array,
	): Promise<ExportJob> => {
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
			if (!canPublish(job)) return job;
			await rename(staging, file);
			published = true;
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
	return (job: ExportJob, bytes: Uint8Array): Promise<ExportJob> => {
		const active = pending.get(job.id);
		if (active) return active;
		const writing = publish(job, bytes).finally(() => pending.delete(job.id));
		pending.set(job.id, writing);
		return writing;
	};
}
