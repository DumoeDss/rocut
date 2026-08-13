"use client";

import * as surfaceReactIdentity from "react";
import { createContext, useContext, useEffect, useState } from "react";

const IdentityProbeContext = createContext("missing");

/**
 * Deliberately carries no `consoleErrors` field. An in-page probe cannot observe
 * the console errors that matter here — React logs invalid-hook-call / #321
 * through the host console before this component could see them — so a field
 * populated from inside the probe could only ever report an empty array and
 * would read as evidence while proving nothing. Console/pageerror coverage is
 * owned by the Playwright run itself (`surface.pw.ts` `page.on("console")` and
 * `page.on("pageerror")`), which fails the run on any unexpected error.
 */
export type SurfaceReactIdentityResult = {
	identity: boolean;
	context: boolean;
	state: boolean;
	effect: boolean;
};

export function SurfaceReactIdentityProbe({
	hostReactIdentity,
	onResult,
}: {
	hostReactIdentity: typeof surfaceReactIdentity;
	onResult: (result: SurfaceReactIdentityResult) => void;
}) {
	const [state, setState] = useState("pending");
	return (
		<IdentityProbeContext.Provider value="context-ok">
			<button
				data-testid="r2-react-state-probe"
				type="button"
				onClick={() => setState("state-ok")}
				hidden
			>
				Exercise React state
			</button>
			<ProbeResult
				hostReactIdentity={hostReactIdentity}
				state={state}
				onResult={onResult}
			/>
		</IdentityProbeContext.Provider>
	);
}

function ProbeResult({
	hostReactIdentity,
	state,
	onResult,
}: {
	hostReactIdentity: typeof surfaceReactIdentity;
	state: string;
	onResult: (result: SurfaceReactIdentityResult) => void;
}) {
	const context = useContext(IdentityProbeContext);
	useEffect(() => {
		onResult({
			identity: hostReactIdentity === surfaceReactIdentity,
			context: context === "context-ok",
			state: state === "state-ok",
			effect: true,
		});
	}, [context, hostReactIdentity, onResult, state]);
	return null;
}
