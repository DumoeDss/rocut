import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { HeadlessProofControlExecution } from "./headless-proof-control";

/** Deliberate browser negative-control dependency and real ReactDOM mount. */
export async function runHeadlessProofControl(): Promise<HeadlessProofControlExecution> {
	const container = document.createElement("div");
	document.documentElement.dataset.c7ReactControlStage = "container-created";
	container.dataset.c7ReactControl = "container";
	document.body.append(container);
	document.documentElement.dataset.c7ReactControlStage = "imports-loaded";
	const root = createRoot(container);
	flushSync(() => {
		root.render(
			React.createElement(
				"span",
				{ "data-c7-react-proof": "mounted" },
				"C7 React sensitivity control",
			),
		);
	});
	document.documentElement.dataset.c7ReactControlStage = "root-mounted";
	return {
		identity: `react:${React.version}:browser-mounted`,
		dispose() {
			root.unmount();
			container.remove();
		},
	};
}
