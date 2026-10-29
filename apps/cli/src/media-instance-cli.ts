import { readFile } from "node:fs/promises";
import { request } from "./host-request";
import type { ResolvedTarget } from "./target-registry";
export async function runMediaInstanceCli(positional:readonly string[],resolved:Pick<ResolvedTarget,"secret">){
 if(positional.length!==2||positional[0]!=="map")throw Error("usage: rocut media-instance map <spec.json>");
 const bytes=await readFile(positional[1]!);if(bytes.byteLength>12*1024**2)throw Error("Media-instance spec exceeds bounds");
 const spec:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
 if(!spec||typeof spec!=="object"||Array.isArray(spec))throw Error("Media-instance spec must be an object");
 return request(resolved.secret,"POST","media-instance/map",spec);
}
