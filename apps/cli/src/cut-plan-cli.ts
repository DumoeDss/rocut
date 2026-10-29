import { readFile } from "node:fs/promises";
import { request } from "./host-request";
import type { ResolvedTarget } from "./target-registry";

export async function runCutPlanCli(
	positional: readonly string[],
	resolved: Pick<ResolvedTarget, "secret">,
	io: {
		request?: typeof request;
		readSpec?: (path: string) => Promise<Uint8Array>;
	} = {},
) {
	if (positional.length !== 2 || positional[0] !== "validate")
		throw Error("usage: rocut cut-plan validate <spec.json>");
	const bytes = await (io.readSpec ?? readFile)(positional[1]!);
	if (bytes.byteLength > 8 * 1024 ** 2)
		throw Error("Cut-plan spec exceeds JSON limit");
	const spec: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(bytes),
	);
	if (!spec || typeof spec !== "object" || Array.isArray(spec))
		throw Error("Cut-plan spec must be an object");
	return (io.request ?? request)(
		resolved.secret,
		"POST",
		"cut-plan/validate",
		spec,
	);
}
