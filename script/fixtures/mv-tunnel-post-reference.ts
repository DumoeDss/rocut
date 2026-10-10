import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import ts from "typescript";
export const TUNNEL_MAIN_SHA256 =
	"3f5e6ff5eb2b7a49e552f1a8da3b3cab0c48e454c226dd943d70abdd51543dd2";
interface OriginalFunction {
	readonly name: "stateFor" | "postFor";
	readonly start: number;
	readonly end: number;
	readonly code: string;
	readonly sha256: string;
}
export interface TunnelPostReference {
	readonly id: "core/gl.js";
	readonly code: string;
	readonly sha256: string;
	readonly main: {
		readonly id: "core/main.js";
		readonly code: string;
		readonly sha256: string;
	};
	readonly functions: readonly OriginalFunction[];
}
/** AST locates the declarations; slices preserve the complete original code. */
export function extractTunnelMainFunctions(
	code: string,
): readonly OriginalFunction[] {
	const source = ts.createSourceFile(
		"main.js",
		code,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	const found: OriginalFunction[] = [];
	const visit = (node: ts.Node) => {
		if (
			ts.isFunctionDeclaration(node) &&
			(node.name?.text === "stateFor" || node.name?.text === "postFor")
		) {
			const start = node.getStart(source),
				end = node.getEnd();
			const original = code.slice(start, end);
			found.push({
				name: node.name.text,
				start,
				end,
				code: original,
				sha256: createHash("sha256").update(original).digest("hex"),
			});
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	if (
		found.length !== 2 ||
		found[0]?.name !== "stateFor" ||
		found[1]?.name !== "postFor"
	)
		throw Error(
			"Original main.js must contain exactly stateFor/postFor declarations",
		);
	return found;
}
export async function loadTunnelPostReference(
	root: string,
): Promise<TunnelPostReference> {
	if (!isAbsolute(root))
		throw Error("Tunnel post reference requires an absolute checkout");
	const path = join(
			root,
			"skills/vocaloid-style-mv/template/engine/core/gl.js",
		),
		info = await lstat(path);
	if (
		!info.isFile() ||
		info.isSymbolicLink() ||
		info.size === 0 ||
		info.size > 1000000
	)
		throw Error("Invalid full original gl.js");
	const bytes = await readFile(path);
	if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191)
		throw Error("Unexpected GL source BOM");
	const mainPath = join(
		root,
		"skills/vocaloid-style-mv/template/engine/core/main.js",
	);
	const mainInfo = await lstat(mainPath);
	if (
		!mainInfo.isFile() ||
		mainInfo.isSymbolicLink() ||
		mainInfo.size === 0 ||
		mainInfo.size > 1000000
	)
		throw Error("Invalid full original main.js");
	const mainBytes = await readFile(mainPath);
	const mainSha = createHash("sha256").update(mainBytes).digest("hex");
	if (mainSha !== TUNNEL_MAIN_SHA256)
		throw Error("Full original main.js SHA pin mismatch");
	const mainCode = new TextDecoder("utf-8", { fatal: true }).decode(mainBytes);
	return {
		id: "core/gl.js",
		code: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		sha256: createHash("sha256").update(bytes).digest("hex"),
		main: { id: "core/main.js", code: mainCode, sha256: mainSha },
		functions: extractTunnelMainFunctions(mainCode),
	};
}
