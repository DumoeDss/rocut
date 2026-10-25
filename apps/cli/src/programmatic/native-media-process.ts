import { spawn } from "node:child_process";

export interface NativeMediaProcessOptions {
	executable: string; args: readonly string[]; signal: AbortSignal;
	maxBytes: number; timeoutMs?: number;
}

/** Bounded native IO, with no shell, inherited credentials or persistent env. */
export async function runNativeMediaProcess({ executable, args, signal, maxBytes, timeoutMs = 8000, media }: NativeMediaProcessOptions & {
	media: "audio" | "video";
}): Promise<Buffer> {
	signal.throwIfAborted();
	const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap(key =>
		process.env[key] === undefined ? [] : [[key, process.env[key]!]],
	));
	return new Promise((resolve, reject) => {
		const child = spawn(executable, [...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env });
		const chunks: Buffer[] = [];
		let stderr = Buffer.alloc(0);
		let size = 0, failure: Error | undefined;
		const stop = (message: string) => { failure ??= Error(message); child.kill(); };
		const abort = () => stop(`Native ${media} decode cancelled`);
		const timer = setTimeout(() => stop(`Native ${media} decode timed out`), timeoutMs);
		signal.addEventListener("abort", abort, { once: true });
		child.once("error", () => { failure ??= Error(`Cannot launch configured native ${media} decoder`); });
		child.stdout.on("data", (chunk: Buffer) => {
			size += chunk.byteLength;
			if (size > maxBytes) stop(`Native ${media} decoder output limit exceeded`);
			else if (!failure) chunks.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => { stderr = Buffer.concat([stderr, chunk]).subarray(-4096); });
		child.once("close", code => {
			clearTimeout(timer); signal.removeEventListener("abort", abort);
			if (failure) reject(failure);
			else if (code !== 0) reject(Error(`Native ${media} decoder failed (exit ${code}): ${stderr.toString('utf8')}`));
			else resolve(Buffer.concat(chunks));
		});
		if (signal.aborted) abort();
	});
}
