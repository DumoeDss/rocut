import assert from "node:assert/strict";
import * as wasm from "opencut-wasm";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withHyperframesAudioGraphAnalyzer } from "../../apps/cli/src/programmatic/hyperframes-audio-analysis";
import type { prepareFunctionalHistoryProject } from "./hyperframes-history-functional-project";

type Project = Awaited<ReturnType<typeof prepareFunctionalHistoryProject>>;
export const functionalHistoryTiming = (source:Project["source"]) => ({source,clipStart:0,clipDuration:96000,trimStart:0,timelineTime:0});
const resolved = (json:string,key:string) => {
	const value = JSON.parse(json);
	assert.equal(value.error,undefined);
	assert.ok(value[key],`Missing ${key}`);
	return value[key];
};

export function assertFunctionalHistoryPreparation(snapshot:any, plan:any) {
	const scalar = snapshot.tracks.find((item:any)=>item.authorId==="scalar-fractional");
	assert.ok(scalar,"Missing real fractional scalar track");
	const expectedMediaStart = 0.010005208333333334;
	// The original runtime's timeline arithmetic can move the authored double
	// by one ULP. Preserve that measured value, without accepting sample rounding.
	assert.ok(Math.abs(scalar.native.mediaStart-expectedMediaStart)<=Number.EPSILON*expectedMediaStart);
	assert.equal(scalar.native.duration,0.4000052083333333);
	assert.equal(scalar.native.playbackRate,1.5);
	assert.equal(scalar.native.loop,false);
	const scalarTrack = plan.tracks.find((item:any)=>item.instanceId===scalar.instanceId);
	// Execution may allocate per-clip dry sources in any order; follow the
	// track's own decodedSourceId instead of assuming a fixed dry# ordinal.
	const recipe = scalarTrack?.decodedSourceId
		? plan.decodedSources.find((item:any)=>item.id===scalarTrack.decodedSourceId)?.ratePreparation
		: undefined;
	assert.ok(recipe,"Fractional scalar trim/duration must retain native recipe");
	assert.equal(recipe.preparationKind,"scalar");
	assert.equal(recipe.mediaStartSeconds,String(scalar.native.mediaStart));
	assert.equal(recipe.durationSeconds,"0.4000052083333333");
	const loop = snapshot.tracks.find((item:any)=>item.authorId==="fractional-loop");
	const loopTrack = plan.tracks.find((item:any)=>item.instanceId===loop?.instanceId);
	assert.ok(plan.decodedSources.find((item:any)=>item.id===loopTrack?.decodedSourceId)?.ratePreparation?.sourceLoop?.nativeBufferClock,
		"Fractional source loop must retain original native buffer scheduler");
}

export async function collectFunctionalHistory(project:Project, executable:string, signal:AbortSignal, artifactDirectory:string) {
	assert.ok(/^[cC]:[\\/]/.test(artifactDirectory),"Native history evidence requires its dedicated C directory");
	return withHyperframesAudioGraphAnalyzer({executable,resourceStore:project.resourceStore,
		request:functionalHistoryTiming(project.source),signal},async analyzer=>{
		const baseline = await analyzer.frame(functionalHistoryTiming(project.source));
		const graph = {version:1,semanticsProfile:"rocut-hyperframes-0.8.139-audio-graph-v1",
			frameRate:project.source.frameRate,durationFrames:20,firstFrame:0,frameCount:20,sampleRate:44100,
			sources:analyzer.sources.map(({id,mimeType,body})=>({id,mimeType,byteLength:body.length})),snapshot:baseline.snapshot};
		const discovery = resolved(wasm.resolveHyperframesAudioDiscoveryJson(JSON.stringify(graph)),"plan");
		const history = await analyzer.history(graph,discovery.seeks);
		// Save measured native facts before any assertion/admission can reject.
		// This is evidence only: do not repair events or filter writes here.
		await writeFile(join(artifactDirectory,"native-history-evidence.json"),
			JSON.stringify({graph,discovery,history},null,2)+"\n",{flag:"wx"});
		const tracks = (baseline.snapshot as {tracks:{instanceId:string;authorId:string}[]}).tracks;
		const histories = history.fallbackHistories as {instanceId:string;events:{sequence:number;appliedAuthorGain:number;gain:{observedAt:number;source:string}}[]}[];
		const dynamic = histories.find(value=>value.instanceId===tracks.find(track=>track.authorId==="dynamic-dom")?.instanceId);
		assert.ok(dynamic && dynamic.events.length>2,"Real DOM fallback writes must survive canonical history");
		assert.ok(dynamic.events.some((event,index)=>index>0 && event.gain.observedAt===dynamic.events[index-1].gain.observedAt),
			"Repeated original native sync writes at the same clock must not deduplicate");
		assert.ok(new Set(dynamic.events.map(event=>event.appliedAuthorGain)).size>2);
		for (const value of histories) for (const [index,event] of value.events.entries()) {
			assert.equal(event.sequence,index);
			assert.equal(event.gain.source,"fallback");
			assert.ok(Number.isFinite(event.appliedAuthorGain));
		}
		const admitted = JSON.parse(wasm.resolveHyperframesAudioObservationsJson(JSON.stringify({version:1,graph,...history})));
		await writeFile(join(artifactDirectory,"native-history-admitted.json"),JSON.stringify(admitted,null,2)+"\n",{flag:"wx"});
		assert.equal(admitted.error,undefined);
		const plan = resolved(wasm.resolveHyperframesAudioExecutionPlanJson(JSON.stringify({version:1,graph,
			faderObservations:admitted.faderObservations,fallbackHistories:admitted.fallbackHistories})),"plan");
		assertFunctionalHistoryPreparation(baseline.snapshot,plan);
		return {history,scan:discovery.nativeHistoryScan,plan};
	});
}
