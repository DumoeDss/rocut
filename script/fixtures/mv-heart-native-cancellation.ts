/** Private browser fixture only. Abort exactly after a real owner image upload
 * starts, not before admission. No production API or scheduling is replaced. */
export async function exerciseHeartNativeCancellation({
	render,
}: {
	render: (signal: AbortSignal) => Promise<ImageBitmap>;
}) {
	const descriptor = Object.getOwnPropertyDescriptor(
		globalThis,
		"createImageBitmap",
	);
	if (!descriptor?.configurable)
		throw Error("Native upload observation unavailable");
	const native = globalThis.createImageBitmap;
	const controller = new AbortController();
	let uploaded: ImageBitmap | undefined;
	let uploads = 0,
		error = "";
	Object.defineProperty(globalThis, "createImageBitmap", {
		...descriptor,
		value: async (...args: unknown[]) => {
			const operation: unknown = Reflect.apply(native, globalThis, args);
			const bitmap: unknown = await operation;
			if (!(bitmap instanceof ImageBitmap))
				throw Error("Invalid native upload result");
			if (args[0] instanceof ImageData) {
				uploaded = bitmap;
				uploads++;
				controller.abort(Error("native Heart acceptance cancellation"));
			}
			return bitmap;
		},
	});
	try {
		try {
			(await render(controller.signal)).close();
		} catch (failure) {
			error = String(failure);
		}
		if (
			!error.includes("native Heart acceptance cancellation") ||
			uploads === 0
		)
			throw Error("Real owner upload was not cancelled at its native boundary");
		if (!uploaded || uploaded.width !== 0 || uploaded.height !== 0)
			throw Error(
				"Late native upload bitmap was not closed before cancellation settled",
			);
		return { uploads, error, lateBitmapClosed: true };
	} finally {
		Object.defineProperty(globalThis, "createImageBitmap", descriptor);
	}
}
