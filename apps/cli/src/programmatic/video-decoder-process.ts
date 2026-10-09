import { runNativeMediaProcess, type NativeMediaProcessOptions } from "./native-media-process";

/** Preserve the video adapter's existing IO/error contract. */
export function runVideoDecoderProcess(options: NativeMediaProcessOptions): Promise<Buffer> {
	return runNativeMediaProcess({ ...options, media: "video" });
}
