import assert from "node:assert/strict";

export interface FunctionalCancellationEvidence {
	callbackReached: boolean;
	requestStarted: boolean;
	cancellationIssued: boolean;
	ownedCount?: number;
	originalError?: {name:string;message:string;stack?:string};
}

/** A setup/admission failure is not evidence that an in-flight request cancelled. */
export async function requireFunctionalCancellation(
	run:()=>Promise<unknown>,
	evidence:FunctionalCancellationEvidence,
	reason:Error,
) {
	let failed=false;
	try {await run();}
	catch(error){
		failed=true;
		evidence.originalError=error instanceof Error
			? {name:error.name,message:error.message,stack:error.stack}
			: {name:"NonError",message:String(error)};
		// Preserve the actual setup/ownership error and its original stack.
		if(!evidence.callbackReached || evidence.ownedCount!==1 || !evidence.requestStarted || !evidence.cancellationIssued)
			throw error;
		if(error!==reason && !(error instanceof Error && /cancelled|closed|disconnected|abort/i.test(error.message)))
			throw error;
	}
	assert.ok(failed,"Cancelled native collection unexpectedly succeeded");
}
