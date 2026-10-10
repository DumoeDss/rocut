import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createProgrammaticAudioService } from "../../apps/cli/src/programmatic/audio-service";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { withHyperframesAudioGraphAnalyzer } from "../../apps/cli/src/programmatic/hyperframes-audio-analysis";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { prepareFunctionalHistoryProject } from "./hyperframes-history-functional-project";
import { collectFunctionalHistory, functionalHistoryTiming } from "./hyperframes-history-functional-history";
import { assertLifecycleBrowserRemoved, ownedLifecycleBrowsers } from "./hyperframes-audio-analysis-lifecycle-process";
import { requireFunctionalCancellation, type FunctionalCancellationEvidence } from "./hyperframes-history-functional-cancellation";

const directory = process.env.ROCUT_HISTORY_FUNCTIONAL_DIRECTORY!;
assert.ok(directory && /^[cC]:[\\/]/.test(directory),"Dedicated C temp output is required");
const executable = process.env.ROCUT_HTML_BROWSER_PATH!;
const toolchainDirectory = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN!;
const decoder = {ffmpeg:process.env.ROCUT_TEST_FFMPEG!,ffprobe:process.env.ROCUT_TEST_FFPROBE!};
const controller = new AbortController();
const timer = setTimeout(()=>controller.abort(Error("Functional history smoke deadline")),240000);
const report:Record<string,unknown> = {status:"running",boundary:"Functional native history and Host PCM delivery; no pixel/MAE/encoded-video/installed acceptance."};
let service:ReturnType<typeof createProgrammaticAudioService>|undefined;
let server:ReturnType<typeof createServer>|undefined;
try {
	const project = await prepareFunctionalHistoryProject(directory,toolchainDirectory,controller.signal);
	await writeFile(join(directory,"compiled-source.json"),JSON.stringify(project.source,null,2),{flag:"wx"});
	// Cancel after analyzer owns its private browser and a frame request starts.
	// Verify its own profile/PID cleanup, then retry with a fresh lifetime below.
	const baseline = ownedLifecycleBrowsers(executable);
	const cancelled = new AbortController();
	const reason = Error("Intentional native history collection cancellation");
	let owned:ReturnType<typeof ownedLifecycleBrowsers>[number]|undefined;
	const cancellation:FunctionalCancellationEvidence={callbackReached:false,requestStarted:false,cancellationIssued:false};
	report.cancellation=cancellation;
	await requireFunctionalCancellation(()=>withHyperframesAudioGraphAnalyzer({executable,resourceStore:project.resourceStore,
		request:functionalHistoryTiming(project.source),signal:AbortSignal.any([controller.signal,cancelled.signal])},async analyzer=>{
		cancellation.callbackReached=true;
		const fresh = ownedLifecycleBrowsers(executable).filter(value=>!baseline.some(previous=>previous.pid===value.pid));
		cancellation.ownedCount=fresh.length;
		assert.equal(fresh.length,1);owned=fresh[0];
		const pending = analyzer.frame(functionalHistoryTiming(project.source));
		cancellation.requestStarted=true;
		cancelled.abort(reason);
		cancellation.cancellationIssued=true;
		await pending;
	}),cancellation,reason);
	assert.ok(owned);assertLifecycleBrowserRemoved(owned);
	assert.deepEqual(ownedLifecycleBrowsers(executable),baseline);
	report.cancelledCollectionReleased = true;
	const history = await collectFunctionalHistory(project,executable,controller.signal,directory);
	await writeFile(join(directory,"native-history.json"),JSON.stringify(history,null,2),{flag:"wx"});
	report.history = {histories:history.history.fallbackHistories.length,observations:history.history.observations.length,
		scanFrames:history.scan.times.length,retryAfterCancel:true};
	service = createProgrammaticAudioService({...project,executable,toolchainDirectory,decoder,connectionFile:""});
	assert.equal(service.capability.hyperframesGraph.configured,true);
	const audioService = service;
	server = createServer((request,response)=>void audioService.handle(request,response,request.url?.endsWith("/identity")?"identity":"render"));
	await new Promise<void>(resolve=>server!.listen(0,"127.0.0.1",resolve));
	const address=server.address();assert.ok(address && typeof address!=="string");
	const provider=createHttpProgrammaticFrames({base:`http://127.0.0.1:${address.port}`});
	const delivered:unknown[]=[];
	// Graph identity is per service namespace: refresh the current identity
	// before each sample-rate pass instead of assuming a prior identity holds.
	for (const sampleRate of [44100,48000] as const) {
		const identity=await provider.getAudioIdentity!({request:{source:project.source,sampleRate},signal:controller.signal});
		const request={source:project.source,firstFrame:0,frameCount:20,sampleRate,expectedIdentity:identity};
		const full=await provider.renderAudio!({request,signal:controller.signal});
		assert.equal(full.hasAudio,true);assert.equal(full.sampleRate,sampleRate);
		assert.equal(full.frames,Math.round(0.8*sampleRate));assert.equal(full.sampleOrigin,0);
		const pcm=Buffer.from(full.pcm);assert.equal(pcm.length,full.frames*8);
		let audible=false;
		for(let offset=0;offset<pcm.length;offset+=4){const value=pcm.readFloatLE(offset);assert.ok(Number.isFinite(value));audible ||= value!==0;}
		assert.ok(audible,"Real native audio delivery must not be fabricated silence");
		await writeFile(join(directory,`full-${sampleRate}.f32le`),pcm,{flag:"wx"});
		if(sampleRate===44100){
			const cropRequest={...request,firstFrame:5,frameCount:6};
			const firstSample=Math.round(5*sampleRate/25),lastSample=Math.round(11*sampleRate/25);
			for(let repeat=0;repeat<2;repeat++){
				const crop=await provider.renderAudio!({request:cropRequest,signal:controller.signal});
				assert.equal(crop.hasAudio,true);assert.equal(crop.sampleOrigin,firstSample);
				assert.equal(crop.frames,lastSample-firstSample);
				assert.ok(Buffer.from(crop.pcm).equals(pcm.subarray(firstSample*8,lastSample*8)),"Crop/reseek must retain exact canonical history PCM");
			}
		}
		delivered.push({sampleRate,frames:full.frames,byteLength:pcm.length,hasAudio:full.hasAudio,
			sha256:createHash("sha256").update(pcm).digest("hex"),cropReseek:sampleRate===44100});
	}
	const nativeExporter={...project.source,audio:{...project.source.audio!,timing:"native-exporter" as const}};
	// The archived toolchain lock was compiled without native-exporter timing;
	// recopy only the lock from a real second compile of the same author input.
	const recompiled=await compileProgrammaticProject({action:"compile",toolchainDirectory,context:project.resourceStore,
		signal:controller.signal,enqueue:task=>task(),input:{version:1,engine:"hyperframes",
		sourceDirectory:join(directory,"author"),entryFile:"source.html",files:["source.html","gsap.js","tone.wav","scalar.wav"],
		width:64,height:64,frameRate:{numerator:25,denominator:1},durationFrames:20,seed:7,
		audio:{version:1,mode:"native",profile:"hyperframes-graph-v1",timing:"native-exporter"}}});
	const exporterSource={...nativeExporter,build:{...nativeExporter.build!,toolchainLock:recompiled.source.build!.toolchainLock}};
	const exporterIdentity=await provider.getAudioIdentity!({request:{source:exporterSource,sampleRate:48000},signal:controller.signal});
	const native=await provider.renderAudio!({request:{source:exporterSource,firstFrame:5,frameCount:6,sampleRate:48000,expectedIdentity:exporterIdentity},signal:controller.signal});
	assert.equal(native.hasAudio,true);assert.equal(native.sampleOrigin,9600);assert.equal(native.frames,11520);
	assert.equal(native.pcm.byteLength,native.frames*8);
	report.nativeExporter={hasAudio:native.hasAudio,frames:native.frames,sampleOrigin:native.sampleOrigin};
	report.delivery=delivered;report.status="passed";
}catch(error){report.status="failed";report.error=error instanceof Error?error.stack:String(error);throw error;}
finally{
	clearTimeout(timer);controller.abort();
	await service?.dispose();
	if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
	await writeFile(join(directory,"verification.json"),JSON.stringify(report,null,2)+"\n",{flag:"wx"});
	console.log(JSON.stringify({status:report.status,report:join(directory,"verification.json")}));
}
