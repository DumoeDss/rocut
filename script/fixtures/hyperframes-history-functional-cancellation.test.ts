import { expect, test } from "bun:test";
import { requireFunctionalCancellation, type FunctionalCancellationEvidence } from "./hyperframes-history-functional-cancellation";

const entered=():FunctionalCancellationEvidence=>({callbackReached:true,ownedCount:1,requestStarted:true,cancellationIssued:true});
test("pre-callback native admission error survives without false cancellation success",async()=>{
	const evidence={callbackReached:false,requestStarted:false,cancellationIssued:false};
	const failure=Error("Invalid native source bytes");
	await expect(requireFunctionalCancellation(async()=>{throw failure;},evidence,Error("cancel"))).rejects.toBe(failure);
	expect((evidence as FunctionalCancellationEvidence).originalError?.message).toBe(failure.message);
});
test("ownership failure survives even when callback was reached",async()=>{
	const evidence={...entered(),ownedCount:0,requestStarted:false,cancellationIssued:false};
	const failure=Error("Expected one owned browser");
	await expect(requireFunctionalCancellation(async()=>{throw failure;},evidence,Error("cancel"))).rejects.toBe(failure);
});
test("unrelated author failure after cancel is not accepted as cancellation",async()=>{
	const failure=Error("Author graph is invalid");
	await expect(requireFunctionalCancellation(async()=>{throw failure;},entered(),Error("cancel"))).rejects.toBe(failure);
});
test("intentional reason or disconnected transport is admitted only after complete entry",async()=>{
	const reason=Error("intentional reason");
	await requireFunctionalCancellation(async()=>{throw reason;},entered(),reason);
	await requireFunctionalCancellation(async()=>{throw Error("Chromium disconnected");},entered(),reason);
	await expect(requireFunctionalCancellation(async()=>{},entered(),reason)).rejects.toThrow("unexpectedly succeeded");
});
