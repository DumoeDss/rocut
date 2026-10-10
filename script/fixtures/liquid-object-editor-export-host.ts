import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
export function openLiquidExportHost(options: {projectRoot:string;staticDir:string;root:string;toolchain:string;executable:string;ffmpeg:string;ffprobe:string}) {
 return startHost({projectRoot:options.projectRoot,staticDir:options.staticDir,registry:new TargetRegistry(`${options.root}/registry`),
 engineToolchainDirectory:options.toolchain,htmlBrowserExecutable:options.executable,htmlFrameConnectionFile:"",
 nativeVideoDecoder:{ffmpeg:options.ffmpeg,ffprobe:options.ffprobe}});
}
