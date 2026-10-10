import type { ProgrammaticResource } from "./programmatic-resources";
import type { MvRole, MvSpan } from "./mv-recipe";
export type MvJz = { sequence:string; sequenceOriginTicks:number; fonts:readonly {fontId:string;resourceId:string}[] };
export type MvJzScene = {kind:"jz";settings:MvJz;role:MvRole;span:MvSpan};
export type MvJzRequest = {sequence:ProgrammaticResource;sequenceTicks:number;sourceStartTicks:number;sourceEndTicks:number;fonts:readonly {fontId:string;resource:ProgrammaticResource}[];residentBytes:number;host?:{recipeReservationBytes:number;sessionCeilingBytes:number;maxLiveSessions:number;rasterByteLimit:number}|null};
export type MvJzRequestNode = {kind:"jzOwnerRequest";role:MvRole;nodeId:string;request:MvJzRequest};
