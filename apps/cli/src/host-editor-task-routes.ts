import type { IncomingMessage } from "node:http";
import type { EditorTaskRegistry } from "./host-editor-tasks";

async function body(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += bytes.length;
		if (size > 8_000_000) throw new Error("editor-task-body-too-large");
		chunks.push(bytes);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function handleEditorTaskRoute({
	request,
	route,
	registry,
	currentRevision,
	respond,
}: {
	request: IncomingMessage;
	route: readonly string[];
	registry: EditorTaskRegistry;
	currentRevision: () => Promise<number>;
	respond: (status: number, value: unknown) => void;
}) {
	if (route.length === 1 && request.method === "GET")
		return respond(200, registry.list());
	if (route.length === 1 && request.method === "POST") {
		const input = await body(request);
		return respond(202, registry.start(input, await currentRevision()));
	}
	const id = route[1];
	if (route.length === 2 && request.method === "GET") {
		const job = registry.get(id);
		return respond(job ? 200 : 404, job ?? { error: "unknown-editor-task" });
	}
	if (route.length === 3 && request.method === "POST") {
		if (route[2] === "report")
			return respond(200, registry.report(id, await body(request)));
		if (route[2] === "cancel") return respond(200, registry.cancel(id));
	}
	respond(404, { error: "unknown-editor-task-route" });
}
