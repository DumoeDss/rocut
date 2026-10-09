import { fallFilterChecks } from "./mv-fall-filtered-rect";
const scope = globalThis as unknown as {
	__fallFilterReference: string;
	__fallFilterResult?: unknown;
};
try {
	scope.__fallFilterResult = fallFilterChecks(scope.__fallFilterReference);
} catch (error) {
	scope.__fallFilterResult = { passed: false, error: String(error) };
}
