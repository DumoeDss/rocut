import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import { resolveCanvasResources } from "../../services/renderer/programmatic/resources";

/** File picker classification; the Host independently admits build revisions. */
export const isAuthorTextFile = (id: string) =>
	/\.(?:html?|css|[cm]?js|tsx?|jsx|json|svg)$/i.test(id);

export async function loadAuthorText({
	source,
	id,
	provider,
	signal,
}: {
	source: ProgrammaticSource;
	id: string;
	provider?: ProgrammaticFrameProvider;
	signal: AbortSignal;
}): Promise<string> {
	const resource = source.build?.inputs.find((item) => item.id === id);
	if (!resource || !isAuthorTextFile(id))
		throw Error("Select an archived text source file.");
	const [loaded] = await resolveCanvasResources({
		resources: [resource],
		provider,
		signal,
	});
	// Retain any authored BOM as a character; opening a file must not alter bytes.
	return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
		loaded.body,
	);
}

function isPropsObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseAuthorProps(text: string): Record<string, unknown> {
	const value: unknown = JSON.parse(text);
	if (!isPropsObject(value)) throw Error("Input props must be a JSON object.");
	return value;
}
