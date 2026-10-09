import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { runProgrammaticSandbox } from "../../packages/editor-classic/src/services/renderer/programmatic/sandbox-runtime";
import {
	check,
	rejects,
	resource,
	orientedJpeg,
	source,
	frame,
	insertedIframe,
} from "./mv-image-metrics-support";

async function run() {
	const canvas = new OffscreenCanvas(3, 2),
		context = canvas.getContext("2d")!;
	context.fillStyle = "#df1730";
	context.fillRect(0, 0, 3, 2);
	context.fillStyle = "#17ef30";
	context.fillRect(0, 0, 1, 1);
	const images: ResolvedProgrammaticResource[] = [];
	for (const type of ["image/png", "image/jpeg", "image/webp"]) {
		const blob = await canvas.convertToBlob({ type, quality: 0.95 });
		check(blob.type === type, `Unsupported actual browser encoder: ${type}`);
		images.push(
			await resource(
				`fixture.${type.split("/")[1]}`,
				type,
				await blob.arrayBuffer(),
			),
		);
	}
	images.push(
		await resource("oriented.jpeg", "image/jpeg", orientedJpeg(images[1].body)),
	);
	const fontBytes = await (await fetch("/metrics-font.ttf")).arrayBuffer();
	const fontImage = await resource("font.ttf", "font/ttf", fontBytes);
	const font: ResolvedProgrammaticResource = {
		...fontImage,
		resource: {
			...fontImage.resource,
			kind: "font",
			font: {
				family: "ImageMetricFixture",
				weight: 400,
				style: "normal",
				axes: { TEST: 100 },
			},
		},
	};
	const all = [...images, font],
		s = source(all.map((r) => r.resource));
	const initial = {
		...frame(s),
		fontMetricRequests: [{ resource: font.resource, glyphs: ["A"] }],
	};
	const iframeCount = document.querySelectorAll("iframe").length;
	const measured = await runProgrammaticSandbox({
		source: s,
		frame: initial,
		resources: all,
		operation: "measure-resources",
	});
	check(
		measured.imageDimensions.length === 4 && measured.fontMetrics.length === 1,
		"Lost coexisting platform facts",
	);
	for (let index = 0; index < images.length; index++) {
		const bitmap = await createImageBitmap(
			new Blob([images[index].body], { type: images[index].resource.mimeType }),
		);
		try {
			const fact = measured.imageDimensions.find(
				(entry) => entry.resource.id === images[index].resource.id,
			);
			check(
				fact &&
					JSON.stringify(fact.resource) ===
						JSON.stringify(images[index].resource),
				"Lost full image identity",
			);
			check(
				fact.width === bitmap.width && fact.height === bitmap.height,
				"Measured dimensions do not match independent decode",
			);
			check(
				fact.width === (index === 3 ? 2 : 3) &&
					fact.height === (index === 3 ? 3 : 2),
				"Wrong default EXIF behavior",
			);
		} finally {
			bitmap.close();
		}
	}
	check(
		measured.fontMetrics[0].glyphs[0].left +
			measured.fontMetrics[0].glyphs[0].right >
			0,
		"Font measurement vanished",
	);
	const item = images[0],
		request = {
			source: source([item.resource]),
			frame: frame(source([item.resource])),
			resources: [item],
			operation: "measure-resources" as const,
		};
	const corrupt = item.body.slice(0);
	new Uint8Array(corrupt)[45] ^= 1;
	await rejects(
		() =>
			runProgrammaticSandbox({
				...request,
				resources: [{ ...item, body: corrupt }],
			}),
		/digest mismatch/,
	);
	await rejects(
		() =>
			runProgrammaticSandbox({
				...request,
				resources: [{ ...item, body: item.body.slice(1) }],
			}),
		/length mismatch/,
	);
	await rejects(
		() =>
			runProgrammaticSandbox({
				...request,
				frame: {
					...request.frame,
					imageDimensionRequests: [
						{ resource: { ...item.resource, id: "forged.png" } },
					],
				},
			}),
		/does not match declaration/,
	);
	const mutable = {
		resource: { ...structuredClone(item.resource) },
		body: item.body.slice(0),
	};
	const mutableSource = source([mutable.resource]);
	const pending = runProgrammaticSandbox({
		source: mutableSource,
		frame: frame(mutableSource),
		resources: [mutable],
		operation: "measure-resources",
	});
	new Uint8Array(mutable.body).fill(0);
	mutable.resource.id = "mutated-after-call.png";
	check(
		(await pending).imageDimensions[0].width === 3,
		"Caller mutated owned image snapshot",
	);
	const stopped = new AbortController();
	stopped.abort(Error("image stopped before decode"));
	await rejects(
		() => runProgrammaticSandbox({ ...request, signal: stopped.signal }),
		/image stopped/,
	);
	const controller = new AbortController(),
		inserted = insertedIframe(iframeCount);
	const inFlight = runProgrammaticSandbox({
		...request,
		signal: controller.signal,
	});
	await inserted;
	controller.abort(Error("in-flight image stopped"));
	await rejects(() => inFlight, /in-flight image stopped/);
	await rejects(
		() =>
			runProgrammaticSandbox({
				...request,
				operation: "render",
				source: source(
					[item.resource],
					"throw Error('intentional post-decode error')",
				),
			}),
		/intentional post-decode error/,
	);
	await rejects(
		() =>
			runProgrammaticSandbox({
				...request,
				operation: "render",
				source: source([item.resource], "await new Promise(() => {})"),
			}),
		/timed out after 5000 ms/,
	);
	const rendered = await runProgrammaticSandbox({
		...request,
		operation: "render",
		source: source(
			[item.resource],
			"const image=assets.image('fixture.png'); if(image.width!==3 || image.height!==2) throw Error('Render geometry changed'); canvas.getContext('2d').drawImage(image,0,0)",
		),
	});
	rendered.close();
	check(
		document.querySelectorAll("iframe").length === iframeCount,
		"Leaked image sandbox iframe",
	);
	return {
		passed: true,
		consumerIntegrated: false,
		scope:
			"Real image/font private bridge; Ember consumer and combined recipe positive acceptance remain pending",
		facts: measured.imageDimensions.map(({ resource, width, height }) => ({
			id: resource.id,
			width,
			height,
		})),
		checks: [
			"actual PNG/JPEG/WebP and EXIF decode",
			"simultaneous font facts",
			"full Resource binding",
			"SHA/length/request rejection",
			"owned source/body snapshot",
			"pre/in-flight cancellation",
			"error/watchdog cleanup and recovery",
			"no iframe leaks",
		],
	};
}
void run().then(
	(value) => Reflect.set(globalThis, "__mvImageMetrics", value),
	(error) =>
		Reflect.set(globalThis, "__mvImageMetrics", {
			passed: false,
			error: String(error?.stack ?? error),
		}),
);
