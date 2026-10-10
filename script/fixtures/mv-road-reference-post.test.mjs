import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const path = "packages/editor-classic/src/services/renderer/programmatic/mv-road-reference-post.ts";
const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("exports", "require", compiled)(module.exports, () => { throw Error("Unexpected runtime dependency"); });
const { applyRoadReferencePost, MV_ROAD_REFERENCE_POST_SOURCE } = module.exports;
// Independent authored reference constants, not recomputed from the executor.
const dawn = [[0,"#120d24"],[.3,"#3a2d63"],[.55,"#9a6aa0"],[.75,"#f3a6a0"],[.9,"#ffd9b0"],[1,"#fffaf0"]];
function request(mode = "tear") {
	return { profile:"road-original-gl-v1",required:true,mode,songTicks:105000,
		shotStartTicks:0,shotEndTicks:1200000,bloom:.55,beatCA:mode === "tear" ? 0 : 2,
		beats:[60000,120000,180000],transition:mode === "tear" ? {kind:"black",durationSeconds:.3} : null,
		dawn:mode === "tear" ? {mix:.08,stops:structuredClone(dawn)} : null,
		plan:{profile:"road-original-gl-v1",required:true,width:1920,height:1080,songTicks:105000,
			lutAtlasRequired:mode === "tear",passes:[
				{shader:"comp",uniforms:{lutA:0,lutB:0,lutMix:mode === "tear" ? .08 : 0}},
				{shader:"final",uniforms:{bloom:.55,fade:0}}]}};
}
function platform({ fail, cancelled = false } = {}) {
	const log=[],created=[],released=[],ctx={canvas:{width:1920,height:1080},
		save(){log.push("save");},restore(){log.push("restore");},
		setTransform(...value){log.push(["transform",value]);},drawImage(...value){log.push(["copy",value]);}};
	let checks=0;
	return {log,created,released,ctx,
		check(){checks++;if(cancelled && checks === 3)throw Error("cancelled after GL");},
		createSurface(width,height){
			const result={width,height,getContext(){return {
				createLinearGradient(...points){log.push(["gradient",points]);return {addColorStop(...stop){log.push(["stop",stop]);}};},
				fillRect(...rect){log.push(["fill",rect]);},
			};}};created.push(result);return result;
		},
		releaseSurface(canvas){canvas.width=canvas.height=1;released.push(canvas);},
		renderReferencePost(input){log.push(["GL",input]);if(fail)throw Error("GL failed");},
	};
}
test("native Dawn draws the original one-row gradient then Rust GL, never the black transition", () => {
	const p=platform(),r=request();applyRoadReferencePost({...p,request:r});
	assert.deepEqual(p.log.filter(v=>Array.isArray(v)&&v[0]==="gradient"),[["gradient",[0,0,256,0]]]);
	assert.deepEqual(p.log.filter(v=>Array.isArray(v)&&v[0]==="stop").map(v=>v[1]),dawn);
	assert.deepEqual(p.log.filter(v=>Array.isArray(v)&&v[0]==="fill"),[["fill",[0,0,256,1]]]);
	const gl=p.log.find(v=>Array.isArray(v)&&v[0]==="GL")[1];
	assert.equal(gl.plan,r.plan);assert.equal(gl.scene,p.ctx.canvas);
	assert.equal(gl.lutAtlas,p.created[1]);assert.equal(p.ctx.globalCompositeOperation,"copy");
	assert.equal(p.ctx.globalAlpha,1);assert.equal(p.ctx.filter,"none");
	assert.deepEqual(p.released,[p.created[1],p.created[0]]);
	assert.equal(p.log.filter(v=>Array.isArray(v)&&v[0]==="copy").length,1);
});
test("run has no ramp; failed/cancelled GL releases every surface without copying", () => {
	const p=platform();applyRoadReferencePost({...p,request:request("run")});
	assert.equal(p.created.length,1);assert.equal(p.log.find(v=>Array.isArray(v)&&v[0]==="GL")[1].lutAtlas,undefined);
	for(const options of [{fail:true},{cancelled:true}]) {
		const p=platform(options);assert.throws(()=>applyRoadReferencePost({...p,request:request()}));
		assert.equal(p.released.length,2);assert.ok(p.created.every(c=>c.width===1&&c.height===1));
		assert.equal(p.log.filter(v=>Array.isArray(v)&&v[0]==="copy").length,0);
	}
});
test("mismatched native identity/policy is rejected before any allocation", () => {
	for(const mutate of [r=>r.plan.profile="tunnel-original-gl-v1",r=>r.plan.songTicks++,r=>r.plan.width=1280,
		r=>r.required=false,r=>r.plan.passes[1].uniforms.fade=.3,r=>r.dawn=null,
		r=>r.plan.passes[0].uniforms.lutMix=.15,r=>r.beatCA=2]) {
		const p=platform(),r=request();mutate(r);assert.throws(()=>applyRoadReferencePost({...p,request:r}));
		assert.equal(p.created.length,0);
	}
});
test("fixed embedded native helper executes without global lookup or imported functions", () => {
	const p=platform();new Function("input",MV_ROAD_REFERENCE_POST_SOURCE+"applyRoadReferencePost(input);")({...p,request:request()});
	assert.equal(p.released.length,2);
});
