import { access, copyFile, mkdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";

/** Validate the caller's destination before paying the cost of rendering. */
export async function prepareOutputDestination(
	out?: string,
): Promise<string | undefined> {
	if (out === undefined) return undefined;
	if (!out.trim()) throw new Error("Output path must not be empty");
	const destination = resolve(out);
	await mkdir(dirname(destination), { recursive: true });
	await access(dirname(destination), constants.W_OK);
	try {
		if (!(await stat(destination)).isFile())
			throw new Error("Output destination is not a regular file");
		await access(destination, constants.W_OK);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return destination;
}

export async function deliverOutput(
	source: string,
	destination?: string,
): Promise<void> {
	if (destination === undefined || resolve(source) === destination) return;
	try {
		await copyFile(source, destination);
	} catch (cause) {
		throw new Error(
			`Render is retained at ${source}; delivery failed. Retry copying this output without rendering again.`,
			{ cause },
		);
	}
}
