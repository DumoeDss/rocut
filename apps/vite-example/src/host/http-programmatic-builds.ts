import { isProgrammaticSource } from "@opencut/editor-contracts";

/** Transport only. The Host admits archived text changes and owns compilation. */
export async function reviseHttpProgrammaticBuild({
	base,
	request,
	signal,
}: {
	base: string;
	request: unknown;
	signal: AbortSignal;
}) {
	signal.throwIfAborted();
	const response = await fetch(
		`${base.replace(/\/$/, "")}/programmatic/build/revise`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request),
			signal,
		},
	);
	try {
		let result: unknown;
		try {
			result = await response.json();
		} catch {
			signal.throwIfAborted();
			throw Error(
				response.ok
					? "Invalid programmatic build revision response: expected JSON"
					: `Programmatic build revision returned ${response.status}`,
			);
		}
		signal.throwIfAborted();
		if (!response.ok)
			throw Error(
				result &&
					typeof result === "object" &&
					"error" in result &&
					typeof result.error === "string"
					? result.error
					: `Programmatic build revision returned ${response.status}`,
			);
		if (
			response.headers
				.get("content-type")
				?.split(";")[0]
				.trim()
				.toLowerCase() !== "application/json" ||
			!result ||
			typeof result !== "object" ||
			Array.isArray(result) ||
			Object.keys(result).length !== 2 ||
			!("source" in result) ||
			!isProgrammaticSource(result.source) ||
			!("reusedDocument" in result) ||
			typeof result.reusedDocument !== "boolean"
		)
			throw Error("Invalid programmatic build revision response");
		return { source: result.source, reusedDocument: result.reusedDocument };
	} catch (error) {
		await response.body?.cancel().catch(() => {});
		signal.throwIfAborted();
		throw error;
	}
}
