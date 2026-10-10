import type { MvRole, MvSpan, MvColor } from "./mv-recipe";
export type MvMetaFreeze = {at?:number;live?:boolean;crackAt?:number;crackXY?:readonly[number,number];crackAngle?:number;crackSeed?:number;desatEnd?:number;desat?:number;push?:number;jitter?:number;split?:number};
export type MvMetaFreezeScene = {kind:"freeze";role:MvRole;input:string;span:MvSpan;settings:MvMetaFreeze};
export interface MvMetaChildSample {readonly input:string;readonly songTicks:number}
export interface MvMetaFreezePlan {
 readonly child:MvMetaChildSample;readonly live:boolean;
 readonly frames:readonly {readonly transform:readonly[number,number,number,number,number,number];readonly clip:readonly(readonly[number,number])[]|null}[];
 readonly greyMix:number;readonly coldAlpha:number;readonly flickerAlpha:number;
 readonly strokes:readonly {readonly paths:readonly(readonly(readonly[number,number])[])[];readonly color:string;readonly width:number;readonly blur:number;readonly composite:GlobalCompositeOperation;readonly joined:boolean}[];
 readonly glows:readonly {readonly center:readonly[number,number];readonly radius:number;readonly color:string;readonly alpha:number}[];
 readonly scratchPixels:number;
}
export type MvMetaRewind = {span?:number;from?:number;follow?:boolean;fps?:number;hold?:number;tail?:number;osd?:boolean;osdFont?:string};
export type MvMetaRewindScene = {kind:"rewind";role:MvRole;input:string;span:MvSpan;settings:MvMetaRewind};
export interface MvMetaRewindPlan {
 readonly child:MvMetaChildSample|null;
 readonly strips:readonly MvMetaBlit[];readonly snow:readonly MvMetaBlit[];
 readonly dropouts:readonly(readonly[number,number,number,number])[];
 readonly slip:number;readonly scanlines:readonly(readonly[number,number,number,number])[];readonly staticRgba:readonly number[];
 readonly osd:null|{readonly fontId:string;readonly texts:readonly {readonly text:string;readonly position:readonly[number,number];readonly size:number;readonly align:CanvasTextAlign}[];readonly arrows:readonly(readonly(readonly[number,number])[])[]};
 readonly scratchPixels:number;
}
export interface MvMetaBlit {readonly source:readonly[number,number,number,number];readonly destination:readonly[number,number,number,number];readonly alpha:number}
export type MvMetaMelt = {at?:number;live?:boolean;rate?:number;meltAt?:number;meltEnd?:number;cols?:number;seed?:number;depth?:number;drip?:number;drops?:number};
export type MvMetaMeltScene = {kind:"melt";role:MvRole;input:string;span:MvSpan;settings:MvMetaMelt};
export interface MvMetaMeltPlan {
 readonly child:MvMetaChildSample;
 readonly columns:readonly {readonly x:number;readonly width:number;readonly y:number;readonly cool:number;readonly echoes:readonly(readonly[number,number])[];readonly front:readonly[number,number]|null}[];
 readonly drops:readonly {readonly rect:readonly[number,number,number,number];readonly center:readonly[number,number];readonly radius:number;readonly alpha:number}[];
 readonly topStops:readonly(readonly[number,string])[];readonly topAlpha:number;readonly blueAlpha:number;readonly stopAlpha:number;readonly scratchPixels:number;
}
export type MvMetaTone = {c0?:MvColor;c1?:MvColor;dot?:MvColor;sun?:readonly[number,number,number];sunColor?:MvColor;step?:number;density?:number;dotA?:number;paper?:number};
export type MvMetaPanelVariant = {input?:string;tone?:MvMetaTone;focus?:readonly[number,number];focusTo?:readonly[number,number];zoom?:readonly[number,number];lines?:"focus"|"speed"|"none";linesAt?:readonly[number,number];linesR?:readonly[number,number];lineColor?:MvColor;impactColor?:MvColor;linesA?:number;linesAngle?:number;linesN?:number};
export type MvMetaPanel = MvMetaPanelVariant & {alt?:MvMetaPanelVariant;punch?:{zoom?:number;focus?:readonly[number,number]};disablePunch?:boolean;dir?:readonly[number,number]};
export type MvMetaPanels = {panels:readonly MvMetaPanel[];collapseAt?:number;hero?:number;gutter?:number;margin?:number;gutterColor?:MvColor;keyline?:MvColor;keylineA?:number;keylineW?:number;openAt?:readonly number[];openDur?:number;order?:readonly number[];layout?:readonly {poly:readonly(readonly[number,number])[];dir?:readonly[number,number]}[];collapseDur?:number;collapseZoom?:number;shake?:number;finalInset?:number;finalFrame?:boolean};
export type MvMetaPanelsScene = {kind:"panelsNative";role:MvRole;span:MvSpan;bpm:number;settings:MvMetaPanels};
export interface MvMetaBorder {readonly poly:readonly(readonly[number,number])[];readonly color:MvColor;readonly width:number;readonly dash:readonly[number,number]|null}
export interface MvMetaPanelsPlan {
 readonly background:MvColor;readonly pageShift:readonly[number,number];
 readonly panels:readonly {readonly child:MvMetaChildSample|null;readonly tone:null|{readonly c0:MvColor;readonly c1:MvColor;readonly sun:readonly[number,number,number]|null;readonly sunColor:MvColor;readonly dotColor:MvColor;readonly dots:readonly(readonly[number,number,number])[];readonly paperAlpha:number};readonly lines:readonly {readonly triangles:readonly(readonly[readonly[number,number],readonly[number,number],readonly[number,number]])[];readonly color:MvColor}[];readonly pen:MvMetaBorder|null;readonly clip:readonly(readonly[number,number])[];readonly translate:readonly[number,number];readonly transform:readonly[number,number,number,number,number,number];readonly flash:"negative"|"paper"|"none";readonly leading:readonly[readonly[number,number],readonly[number,number]]|null;readonly leadingColor:MvColor;readonly keyline:MvMetaBorder|null}[];
 readonly paper:null|{readonly rgba:string;readonly blotches:readonly {readonly center:readonly[number,number];readonly radius:number;readonly alpha:number}[];readonly fibers:readonly(readonly[readonly[number,number],readonly[number,number],readonly[number,number]])[]};
 readonly collapseFlash:number;readonly finalFrame:MvMetaBorder|null;readonly scratchPixels:number;
}
