/** Same-origin authenticated transport only; never passes browser filesystem paths. */
export async function inspectHttpProgrammaticAnimation({
	base,
	resource,
	signal,
}: {
	base: string;
	resource: unknown;
	signal: AbortSignal;
}): Promise<unknown> {
	signal.throwIfAborted();
	const response = await fetch(
		`${base.replace(/\/$/, "")}/programmatic/animation-inspect`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ resource }),
			signal,
		},
	);
	try {
		const result: unknown = await response.json();
		signal.throwIfAborted();
		if (!response.ok)
			throw Error(
				result &&
					typeof result === "object" &&
					"error" in result &&
					typeof result.error === "string"
					? result.error
					: `Animation inspection returned ${response.status}`,
			);
		if (
			response.headers
				.get("content-type")
				?.split(";")[0]
				.trim()
				.toLowerCase() !== "application/json"
		)
			throw Error("Invalid animation inspection response format");
		return result;
	} catch (error) {
		await response.body?.cancel().catch(() => {});
		signal.throwIfAborted();
		throw error;
	}
}
