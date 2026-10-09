import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { isProgrammaticResource } from "@opencut/editor-contracts";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { exportImageSequence } from "./image-sequence-export";

async function run() {
	const source: ProgrammaticSource = Reflect.get(
		globalThis,
		"__importedSequenceSource",
	);
	if (!source?.recipe || source.resources?.[0]?.kind !== "imageSequence")
		throw Error("Missing imported sequence descriptor");
	const delegate = createHttpProgrammaticFrames({
		base: new URL("../../api", location.href).pathname,
	});
	const reads: Record<string, number> = {};
	const exported = await exportImageSequence(
		{ source },
		{
			...delegate,
			loadResource: async (request) => {
				if (!isProgrammaticResource(request.resource))
					throw Error("Invalid imported resource descriptor");
				const id = request.resource.id;
				reads[id] = (reads[id] ?? 0) + 1;
				return delegate.loadResource!(request);
			},
		},
	);
	if (!Object.keys(reads).some((id) => id.startsWith("frames/")))
		throw Error("Export did not use the real Host frame resource route");
	return {
		...exported,
		passed: true,
		resourceReads: reads,
		hostImportTested: true,
		installedElectronTested: false,
	};
}

void run().then(
	(value) => Reflect.set(globalThis, "__imageSequenceHostResult", value),
	(error) =>
		Reflect.set(globalThis, "__imageSequenceHostResult", {
			error: String(error?.stack ?? error),
		}),
);
