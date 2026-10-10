export const alphaEmptyStackError = "At least one effect pass is required";

export async function alphaEmptyStackRejection(call: () => unknown) {
	try {
		await call();
		return { attempted: true, rejected: false, matched: false, error: "" };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			attempted: true,
			rejected: true,
			matched: message === alphaEmptyStackError,
			error: message,
		};
	}
}
