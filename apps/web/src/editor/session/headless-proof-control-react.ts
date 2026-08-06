import * as React from "react";
import type { HeadlessProofControlExecution } from "./headless-proof-control";

/** Deliberate server negative-control dependency with explicit no-DOM identity. */
export async function runHeadlessProofControl(): Promise<HeadlessProofControlExecution> {
	return {
		identity: `react:${React.version}:server-no-dom`,
		dispose() {},
	};
}
