export function particleDeadline<T>(
	work: Promise<T>,
	milliseconds: number,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(Error("Particle broker cleanup deadline exceeded")),
			milliseconds,
		);
		work.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}
