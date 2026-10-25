/** Bounded diagnostics for a public font-readiness report; never dump the report. */
export function fontReadinessDifferences(pinned, current, limit = 12) {
	const differences = [];
	const summarize = (value) => {
		if (Array.isArray(value)) return `array(${value.length})`;
		if (value !== null && typeof value === "object") return "object";
		const text = JSON.stringify(value) ?? "<missing>";
		return text.length > 160 ? `${text.slice(0, 160)}…` : text;
	};
	function visit(left, right, path) {
		if (differences.length >= limit || Object.is(left, right)) return;
		if (left !== null && right !== null && typeof left === "object" &&
			typeof right === "object" && Array.isArray(left) === Array.isArray(right)) {
			for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
				visit(left[key], right[key], `${path}/${key}`);
				if (differences.length >= limit) break;
			}
			return;
		}
		differences.push({ field: path || "/", pinned: summarize(left), current: summarize(right) });
	}
	visit(pinned, current, "");
	return differences;
}
