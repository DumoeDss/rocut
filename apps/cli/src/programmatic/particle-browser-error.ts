/** Bounded diagnostics across the page boundary; retain primary Rust and cleanup causes. */
export function particlePageErrorMessage(cause: unknown): string {
	const seen = new Set<object>();
	const parts: string[] = [];
	let nodes = 0;
	const read = (value: object, key: string): unknown => {
		try {
			return (value as Record<string, unknown>)[key];
		} catch {
			return undefined;
		}
	};
	const text = (value: unknown): string => {
		try {
			return String(value).slice(0, 200);
		} catch {
			return "Unprintable particle error";
		}
	};
	const visit = (value: unknown, depth: number) => {
		if (++nodes > 12 || depth > 3) return;
		if (!value || typeof value !== "object") {
			parts.push(text(value));
			return;
		}
		if (seen.has(value)) return;
		seen.add(value);
		const name = read(value, "name"),
			message = read(value, "message");
		parts.push(
			typeof message === "string"
				? `${typeof name === "string" ? text(name) : "Error"}: ${text(message)}`
				: text(value),
		);
		const responseJson = read(value, "responseJson");
		if (typeof responseJson === "string" && responseJson.length <= 16_384) {
			try {
				const response = JSON.parse(responseJson) as {
					error?: { code?: unknown; path?: unknown; message?: unknown };
				};
				if (response.error)
					parts.push(
						`Rust ${text(response.error.code)} at ${text(response.error.path)}: ${text(response.error.message)}`,
					);
			} catch {
				/* The client owns validation; malformed diagnostics add nothing. */
			}
		}
		const nested = read(value, "errors");
		if (Array.isArray(nested))
			for (const error of nested.slice(0, 4)) visit(error, depth + 1);
		const prior = read(value, "cause");
		if (prior !== undefined) visit(prior, depth + 1);
	};
	visit(cause, 0);
	return parts.join("; ").slice(0, 1000);
}
