export const DEFAULT_OVERALL_TIMEOUT_MS = 900000;

/** Harness observation budget only; never changes native per-frame watchdogs. */
export function parseOverallTimeout(args) {
	const supplied = [];
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--overall-timeout-ms") supplied.push(args[++index]);
		else if (argument.startsWith("--overall-timeout-ms="))
			supplied.push(argument.slice("--overall-timeout-ms=".length));
	}
	if (supplied.length === 0) return DEFAULT_OVERALL_TIMEOUT_MS;
	if (
		supplied.length !== 1 ||
		typeof supplied[0] !== "string" ||
		!/^\d+$/.test(supplied[0])
	)
		throw Error(
			"Provide --overall-timeout-ms once as an integer between 60000 and 3600000",
		);
	const value = Number(supplied[0]);
	if (!Number.isSafeInteger(value) || value < 60000 || value > 3600000)
		throw Error(
			"Overall fixture timeout must be between 60000 and 3600000 milliseconds",
		);
	return value;
}
