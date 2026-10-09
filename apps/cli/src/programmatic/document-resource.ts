import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";

/** Strict decoding before execution; never silently repair corrupt authored code. */
export function decodeHtmlDocument(body: ArrayBuffer): string {
	const code = new TextDecoder("utf-8", { fatal: true }).decode(body);
	if (!code.trim()) throw new Error("HTML document attachment must not be empty");
	return code;
}

/** Rust has validated the reference; bytes must already pass attachment integrity. */
export function resolveHtmlDocumentCode(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
): string {
	if (source.documentId === undefined) return source.code;
	const document = resources.find(({ resource }) => resource.id === source.documentId);
	if (!document || document.resource.kind !== "document")
		throw new Error("Missing HTML document attachment");
	return decodeHtmlDocument(document.body);
}
