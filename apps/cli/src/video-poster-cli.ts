import {
	createVideoPoster,
	videoPosterCapability,
	type VideoPosterInput,
} from "./video-poster";

/** Only private host process configuration supplies decoder paths. */
export async function runVideoPosterCli(
	args: readonly string[],
	io: {
		input?: AsyncIterable<Uint8Array>;
		output?: (text: string) => void;
		signal?: AbortSignal;
	} = {},
) {
	if (args.length !== 1 || !["capabilities", "create"].includes(args[0]))
		throw Error(
			"usage: rocut video-poster capabilities|create (create reads fixed JSON from stdin)",
		);
	const decoder =
		process.env.ROCUT_NATIVE_FFMPEG_PATH &&
		process.env.ROCUT_NATIVE_FFPROBE_PATH
			? {
					ffmpeg: process.env.ROCUT_NATIVE_FFMPEG_PATH,
					ffprobe: process.env.ROCUT_NATIVE_FFPROBE_PATH,
				}
			: undefined;
	const output = io.output ?? ((text) => process.stdout.write(text));
	if (args[0] === "capabilities") {
		output(JSON.stringify(await videoPosterCapability(decoder)) + "\n");
		return;
	}
	const controller = new AbortController();
	const abort = () => controller.abort(io.signal?.reason);
	io.signal?.addEventListener("abort", abort, { once: true });
	if (io.signal?.aborted) abort();
	let accept!: (value: VideoPosterInput) => void,
		fail!: (error: unknown) => void;
	const request = new Promise<VideoPosterInput>((resolve, reject) => {
		accept = resolve;
		fail = reject;
	});
	let received = false,
		pending = Buffer.alloc(0);
	const input = io.input ?? process.stdin;
	const consume = (async () => {
		try {
			for await (const chunk of input) {
				pending = Buffer.concat([pending, chunk]);
				if (pending.length > 8192)
					throw Error("Poster request exceeds input limit");
				let newline: number;
				while ((newline = pending.indexOf(10)) !== -1) {
					const line = new TextDecoder("utf-8", { fatal: true }).decode(
						pending.subarray(0, newline),
					);
					pending = pending.subarray(newline + 1);
					if (!received) {
						received = true;
						accept(JSON.parse(line) as VideoPosterInput);
					} else if (line === "cancel")
						controller.abort(Error("Poster cancelled by host"));
					else throw Error("Unsupported poster control message");
				}
			}
			if (!received || pending.length)
				throw Error("Poster request must be one JSON line");
		} catch (error) {
			fail(error);
			controller.abort(error);
		}
	})();
	try {
		output(
			JSON.stringify(
				await createVideoPoster(await request, {
					decoder,
					signal: controller.signal,
				}),
			) + "\n",
		);
	} finally {
		io.signal?.removeEventListener("abort", abort);
		if (input === process.stdin) process.stdin.destroy();
		// Reader owns only this invocation's stream. It cannot block result delivery.
		void consume;
	}
}
