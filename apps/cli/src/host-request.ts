/** CLI-to-host transport diagnostics; never edits or upgrades a project. */
export class CliRequestError extends Error {
	readonly status: number;
	readonly method: "GET" | "POST";
	readonly route: string;
	readonly response: unknown;

	constructor(args: {
		readonly status: number;
		readonly method: "GET" | "POST";
		readonly route: string;
		readonly response: unknown;
		readonly message: string;
	}) {
		super(args.message);
		this.name = "CliRequestError";
		this.status = args.status;
		this.method = args.method;
		this.route = args.route;
		this.response = args.response;
	}
}

export async function request(
	secret: { port: number; token: string },
	method: "GET" | "POST",
	route: string,
	body?: unknown,
): Promise<unknown> {
	const response = await fetch(
		`http://127.0.0.1:${secret.port}/${secret.token}/api/${route}`,
		{
			method,
			...(body === undefined
				? {}
				: {
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}),
		},
	);
	let parsed: unknown;
	try {
		parsed = await response.json();
	} catch {
		parsed = {
			code: "invalid-host-response",
			error: "Host returned a non-JSON response.",
		};
		if (response.ok)
			throw new CliRequestError({
				status: response.status,
				method,
				route,
				response: parsed,
				message: method + " /" + route + " returned a non-JSON response.",
			});
	}
	// Only a missing catalog endpoint proves this capability is unavailable.
	// A missing sequence, authentication refusal or server outage does not.
	if (
		method === "GET" &&
		route === "motion-text/catalog" &&
		response.status === 404
	) {
		parsed = {
			code: "motion-text-capability-unavailable",
			capability: "motion-text",
			action: "upgrade-rocut-and-reopen",
			message:
				"This Rocut host does not expose the motion-text catalog. Upgrade the Rocut plugin (or standalone Rocut host), then reopen its editor and retry. If already updated, restart the stale Rocut host. This check made no project changes.",
		};
	}
	if (!response.ok) {
		// The host answers errors with `{ error }` (19 routes) — `{ message }` is
		// the shape TransactionError surfaces. Reading only `message` silently
		// reduced every other failure to a bare status word ("Conflict"), which
		// is exactly the text an operator cannot act on: the host's own
		// explanation ("no editor pane is attached…") never reached the caller.
		const field = (name: string): string | undefined =>
			typeof parsed === "object" &&
			parsed !== null &&
			name in parsed &&
			typeof (parsed as Record<string, unknown>)[name] === "string"
				? (parsed as Record<string, string>)[name]
				: undefined;
		const message = field("message") ?? field("error") ?? response.statusText;
		throw new CliRequestError({
			status: response.status,
			method,
			route,
			response: parsed,
			message: `${method} /${route} failed (${response.status}): ${message}`,
		});
	}
	return parsed;
}
