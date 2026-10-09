import type {
	MvPreparedPatchCommand,
	MvRecipePlan,
} from "@opencut/editor-contracts";

function isPreparedPatch(value: unknown): value is MvPreparedPatchCommand {
	if (
		!value ||
		typeof value !== "object" ||
		Reflect.get(value, "kind") !== "preparedPatch" ||
		typeof Reflect.get(value, "patchKey") !== "string"
	)
		return false;
	const request: unknown = Reflect.get(value, "request");
	if (!request || typeof request !== "object") return false;
	const binding: unknown = Reflect.get(request, "binding"),
		roi: unknown = Reflect.get(request, "roi");
	if (
		!binding ||
		typeof binding !== "object" ||
		!roi ||
		typeof roi !== "object"
	)
		return false;
	const resource: unknown = Reflect.get(binding, "resource"),
		at: unknown = Reflect.get(binding, "flameAt");
	if (
		!resource ||
		typeof resource !== "object" ||
		Reflect.get(resource, "kind") !== "image"
	)
		return false;
	return (
		["id", "attachmentKey", "mimeType", "sha256"].every(
			(key) => typeof Reflect.get(resource, key) === "string",
		) &&
		typeof Reflect.get(resource, "byteLength") === "number" &&
		typeof Reflect.get(binding, "width") === "number" &&
		typeof Reflect.get(binding, "height") === "number" &&
		Reflect.get(binding, "algorithm") === "flame-deflame-v1" &&
		Array.isArray(at) &&
		at.length === 6 &&
		at.every((v) => typeof v === "number") &&
		["x", "y", "width", "height"].every(
			(key) => typeof Reflect.get(roi, key) === "number",
		)
	);
}

/** Read only a canonical Rust plan. No supplied pixels, allocation limit or key
 * reconstruction participates in discovery. WASM validates each full binding. */
export function imagePreprocessCommands(
	plan: MvRecipePlan,
): MvPreparedPatchCommand[] {
	const commands: MvPreparedPatchCommand[] = [];
	const stack: unknown[] = [plan];
	let visited = 0;
	while (stack.length) {
		if (++visited > 100000)
			throw Error("Image preprocessing plan traversal limit exceeded");
		const value = stack.pop();
		if (!value || typeof value !== "object") continue;
		if (Reflect.get(value, "kind") === "preparedPatch") {
			if (!isPreparedPatch(value))
				throw Error("Invalid canonical preprocessing command");
			commands.push(value);
			continue;
		}
		for (const child of Object.values(value))
			if (child && typeof child === "object") stack.push(child);
	}
	return commands;
}

export function hasFlamePlan(plan: MvRecipePlan): boolean {
	const stack: unknown[] = [plan];
	while (stack.length) {
		const value = stack.pop();
		if (!value || typeof value !== "object") continue;
		if (Reflect.get(value, "kind") === "flame") return true;
		for (const child of Object.values(value))
			if (child && typeof child === "object") stack.push(child);
	}
	return false;
}

/** Reserve owned Canvas scratch before creating a render realm. The interpreter
 * also enforces this private limit against actual allocations, fail closed. */
export function imagePreprocessRasterBytes({
	plan,
	width,
	height,
}: {
	plan: MvRecipePlan;
	width: number;
	height: number;
}): number {
	let bytes = width * height * 4 * 8;
	const stack: unknown[] = [plan];
	while (stack.length) {
		const value = stack.pop();
		if (!value || typeof value !== "object") continue;
		if (Reflect.get(value, "kind") === "flame") {
			const data: unknown = Reflect.get(value, "data");
			if (!data || typeof data !== "object")
				throw Error("Missing Rust Flame raster budget");
			const budget: unknown = Reflect.get(data, "rasterBudgetBytes");
			if (
				typeof budget !== "number" ||
				!Number.isSafeInteger(budget) ||
				budget < 0
			)
				throw Error("Invalid Rust Flame raster budget");
			bytes += budget;
		}
		for (const child of Object.values(value))
			if (child && typeof child === "object") stack.push(child);
	}
	if (!Number.isSafeInteger(bytes) || bytes < 1)
		throw Error("Invalid image preprocessing raster allocation");
	return bytes;
}
