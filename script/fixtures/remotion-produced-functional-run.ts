import {mkdtemp,mkdir,stat} from "node:fs/promises";
import {resolve,join} from "node:path";
import {bindRemotionProducedFunctionalWasm} from "./remotion-produced-functional-preload";

// Explicit execution opt-in: importing/preparing this file never launches tools.
if(process.env.ROCUT_RUN_REMOTION_PRODUCED_FUNCTIONAL!=="1")throw Error("Set ROCUT_RUN_REMOTION_PRODUCED_FUNCTIONAL=1 only when the serial functional run is authorized");
const wasm=resolve(process.env.ROCUT_PRODUCED_FUNCTIONAL_WASM??"C:/Users/Sayo/AppData/Local/Temp/rocut-native-delivery-20261010-74652f9b/wasm");
const toolchain=resolve(process.env.ROCUT_ENGINE_TOOLCHAIN_DIR??"C:/Users/Sayo/AppData/Local/Temp/rocut-media-toolchain-YbloF9");
const chromium=resolve(process.env.ROCUT_HTML_BROWSER_PATH??"C:/Program Files/Google/Chrome/Application/chrome.exe");
const ffmpeg=resolve(process.env.ROCUT_NATIVE_FFMPEG_PATH??"E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe");
const ffprobe=resolve(process.env.ROCUT_NATIVE_FFPROBE_PATH??"E:/Software/ffmpeg-6.0-full_build/bin/ffprobe.exe");
for(const file of [join(wasm,"opencut_wasm_sync.js"),join(toolchain,"package-lock.json"),chromium,ffmpeg,ffprobe])if(!(await stat(file)).isFile())throw Error("Missing preinstalled functional input: "+file);
const parent=resolve("C:/Users/Sayo/AppData/Local/Temp"),root=await mkdtemp(join(parent,"remotion-produced-functional-"));
const temporary=join(root,"temp");await mkdir(temporary);process.env.TEMP=temporary;process.env.TMP=temporary;
await bindRemotionProducedFunctionalWasm(wasm);
const {runRemotionProducedFunctional}=await import("./remotion-produced-functional-driver");
try {const result=await runRemotionProducedFunctional({root,toolchain,chromium,ffmpeg,ffprobe});console.log(JSON.stringify({status:result.status,outputRoot:root}));}
catch(error){console.error("Functional run failed; owned outputs retained at "+root);throw error;}
