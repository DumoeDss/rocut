import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const RETRY_DELAYS_MS = [10, 25, 50, 100, 200];

/** Replace one file without ever deleting its previous committed contents. */
export async function writeAtomic({
	filePath,
	contents,
	platform = process.platform,
	renameFile = rename,
	wait = delay,
}: {
	filePath: string;
	contents: string;
	platform?: NodeJS.Platform;
	renameFile?: typeof rename;
	wait?: (milliseconds: number) => Promise<unknown>;
}): Promise<void> {
	const temp = `${filePath}.tmp-${randomUUID()}`;
	// Exclusive creation establishes ownership before any cleanup is allowed.
	const handle = await open(temp, "wx");
	let committed = false;
	try {
		try {
			await handle.writeFile(contents, "utf8");
		} finally {
			await handle.close();
		}
		for (let attempt = 0; ; attempt++) {
			try {
				await renameFile(temp, filePath);
				committed = true;
				return;
			} catch (error) {
				const code =
					typeof error === "object" && error !== null && "code" in error
						? error.code
						: undefined;
				const backoff = RETRY_DELAYS_MS[attempt];
				if (
					platform !== "win32" ||
					typeof code !== "string" ||
					!["EPERM", "EACCES", "EBUSY"].includes(code) ||
					backoff === undefined
				) {
					throw error;
				}
				await wait(backoff);
			}
		}
	} finally {
		// Only our own uncommitted temporary file may be removed. Never unlink
		// the destination to force a rename, and never hide the original error.
		if (!committed) await unlink(temp).catch(() => undefined);
	}
}
