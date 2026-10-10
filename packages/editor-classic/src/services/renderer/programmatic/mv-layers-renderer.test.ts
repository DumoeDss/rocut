import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { MV_LAYERS_RENDERER_SOURCE } from "./mv-layers-renderer";
import { MV_RECIPE_RENDERER_SOURCE } from "./mv-recipe-renderer";
import { jzNativeRequests, MV_JZ_NATIVE_FRAMES_SOURCE } from "./mv-jz-native-transport";
import type { MvPlanNode } from "../../../../../editor-contracts/src/mv-recipe-plan";

class Surface {
	width = 64; height = 32; pixels: string[] = [];
	ctx = {
		globalCompositeOperation: "source-over", globalAlpha: 1, filter: "none", shadowColor: "transparent", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
		fillStyle: "", save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, setTransform() {},
		clearRect: () => { this.pixels = []; },
		fillRect: () => { this.pixels.push(this.ctx.fillStyle); },
		drawImage: (surface: Surface) => { this.pixels.push(...surface.pixels); },
	};
	getContext() { return this.ctx; }
}

test("Layers fixed full replay keeps imageSequence + overlays under ref/panels in canonical role order", () => {
	const render = runInNewContext(MV_RECIPE_RENDERER_SOURCE + ";renderMvRecipe") as (...args: unknown[]) => void;
	const seq = {kind:"imageSequence",role:"background",imageKey:"seq:frame7",view:{x:0,y:0,zoom:1}};
	const solid = (role: string, color: number[]) => ({kind:"solid",role,color});
	const layers = {kind:"layers",items:[
		{input:solid("graphics",[0,0,1,1]),roles:["graphics"]},
		{input:seq,roles:["background"]},
		{input:solid("subject",[1,0,0,1]),roles:["subject"]},
		{input:solid("subject",[0,1,0,1]),roles:["subject"]},
		{input:solid("foreground",[1,1,1,1]),roles:["background"]},
	]};
	const root = {kind:"panels",panels:[{polygon:[[0,0],[64,0],[64,32],[0,32]],transform:[1,0,0,1,0,0],input:{kind:"ref",input:layers}}]};
	const canvas = new Surface(), surfaces: Surface[] = [], image = new Surface(); image.pixels = ["sequence7"];
	render(canvas,{version:1,root,post:[],outputRoles:["background","subject","graphics","foreground"]},{sequenceImage:(key:string)=>{assert.equal(key,"seq:frame7");return image;}},()=>{const s=new Surface();surfaces.push(s);return s;});
	assert.deepEqual(canvas.pixels,["sequence7","rgba(255,0,0,1)","rgba(0,255,0,1)","rgba(0,0,255,1)"]);
	assert.ok(surfaces.every(s=>s.width===1&&s.height===1));
});

test("Layers isolated children cannot clear prior pixels; cancellation and errors release current child", () => {
	const helper = runInNewContext(MV_LAYERS_RENDERER_SOURCE + ";mvLayersDraw") as (...args: unknown[]) => Generator;
	const output = new Surface(), released: Surface[] = [];
	function* draw(input: string) { const child=new Surface(); child.pixels=[input]; child.ctx.clearRect(); child.pixels=[input]; return child; }
	const node={items:[{input:"first",roles:["subject"]},{input:"second",roles:["subject"]}]};
	const release=(s:Surface)=>{released.push(s);s.width=1;s.height=1;};
	for(const _ of helper(output.ctx,node,"subject",draw,release,()=>{})) {}
	assert.deepEqual(output.pixels,["first","second"]);assert.equal(released.length,2);
	const cancelled=helper(output.ctx,node,"subject",draw,release,()=>{});cancelled.next();cancelled.return(undefined);assert.equal(released.length,3);
	let checks=0; const throwing=helper(output.ctx,node,"subject",draw,release,()=>{if(++checks===2)throw Error("cancelled");});
	assert.throws(()=>throwing.next(),/cancelled/);assert.equal(released.length,4);
});

test("Layers full replay releases child and parent when cancellation interrupts a child yield", () => {
	const steps=runInNewContext(MV_RECIPE_RENDERER_SOURCE+";renderMvRecipeSteps") as (...args:unknown[])=>Generator;
	const surfaces:Surface[]=[];
	const root={kind:"layers",items:[{roles:["background"],input:{kind:"solid",role:"background",color:[1,0,0,1]}}]};
	const iterator=steps(new Surface(),{version:1,root,post:[],outputRoles:["background"]},{},()=>{const s=new Surface();surfaces.push(s);return s;});
	iterator.next();
	assert.equal(surfaces.length,2);assert.ok(surfaces.some(s=>s.width===64));
	iterator.return(undefined);
	assert.ok(surfaces.every(s=>s.width===1&&s.height===1));
});

test("Layers owner admission traverses every repeated occurrence even when a role mask excludes it", () => {
	const leaf={kind:"jzOwnerRequest",role:"foreground",nodeId:"owner",request:{sequenceTicks:7}};
	const root={kind:"layers",items:[{input:leaf,roles:["background"]},{input:{kind:"ref",input:leaf},roles:["subject"]}]} as unknown as MvPlanNode;
	assert.equal(jzNativeRequests(root).length,2);
	class Bitmap {width=1920;height=1080;}
	const apply=runInNewContext(MV_JZ_NATIVE_FRAMES_SOURCE+";mvJzNativeFrames",{ImageBitmap:Bitmap}) as (...args:unknown[])=>Map<string,unknown>;
	const bitmap=new Bitmap(),key=JSON.stringify(leaf),owned=new Set<unknown>();
	assert.equal(apply({root},[{requestKey:key,bitmap,width:1920,height:1080,rgbaSha256:"a".repeat(64)}],owned,()=>{}).size,1);
	assert.ok(owned.has(bitmap));
});
