import type { IncomingMessage, ServerResponse } from "node:http";
import {
	OBJECT_PARAMS_MAX_BYTES,
	ObjectParamsUnavailableError,
	resolveProgrammaticObjectParams,
	type ObjectParamsExports,
} from "./object-params";

function readBody(request: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const cleanup = () => {
			clearTimeout(timer);
			request.removeListener("data", data);
			request.removeListener("end", end);
			request.removeListener("error", fail);
			request.removeListener("aborted", aborted);
		};
		const fail = (cause: Error) => { cleanup(); request.resume(); reject(cause); };
		const aborted = () => fail(Error("Object params request aborted"));
		const data = (chunk: Buffer | string) => {
			const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += bytes.byteLength;
			if (size > OBJECT_PARAMS_MAX_BYTES) { fail(Error("Object params JSON budget exceeded")); return; }
			chunks.push(bytes);
		};
		const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
		const timer = setTimeout(() => fail(Error("Object params request timed out")), 10_000);
		request.on("data", data);
		request.once("end", end);
		request.once("error", fail);
		request.once("aborted", aborted);
	});
}

// The owning Host router authenticates before entering this read-only route.
export async function handleProgrammaticObjectParamsRoute(
	request: IncomingMessage,
	response: ServerResponse,
	exports?: ObjectParamsExports,
): Promise<void> {
	let status = 200;
	let body: string;
	try {
		if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers["content-type"] ?? ""))
			throw Error("Object params requires application/json");
		const input: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBody(request)));
		body = resolveProgrammaticObjectParams(input, exports);
	} catch (cause) {
		status = cause instanceof ObjectParamsUnavailableError ? 503 : 400;
		body = JSON.stringify({ error: cause instanceof Error ? cause.message : "Object params transport failed" });
	}
	response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
	response.end(body);
}
