export class ParticleProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ParticleProtocolError";
	}
}
