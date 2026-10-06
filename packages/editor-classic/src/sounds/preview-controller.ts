export interface SoundPreviewSource {
	id: number;
	previewUrl?: string;
}

export interface SoundPreviewAudio {
	play(): Promise<void>;
	pause(): void;
	load(): void;
	removeAttribute(name: string): void;
	addEventListener(type: "ended" | "error", listener: () => void): void;
	removeEventListener(type: "ended" | "error", listener: () => void): void;
}

/** Owns one HTML media element, including pending playback and its listeners. */
export function createSoundPreviewController({
	onChange,
	onError,
	createAudio = (url) => new Audio(url),
}: {
	onChange: (id: number | null) => void;
	onError: (message: string) => void;
	createAudio?: (url: string) => SoundPreviewAudio;
}) {
	let disposed = false;
	let active: {
		id: number;
		url: string;
		audio: SoundPreviewAudio;
		ended: () => void;
		failed: () => void;
	} | null = null;

	const stop = () => {
		const previous = active;
		active = null;
		if (!previous) return;
		previous.audio.removeEventListener("ended", previous.ended);
		previous.audio.removeEventListener("error", previous.failed);
		previous.audio.pause();
		previous.audio.removeAttribute("src");
		// Reset the media resource selection, cancelling pending downloads/decoders.
		previous.audio.load();
		if (!disposed) onChange(null);
	};
	const reportFailure = () =>
		onError(
			"Unable to preview this sound. Try again or import the audio from Media.",
		);

	return {
		toggle: ({ sound }: { sound: SoundPreviewSource }) => {
			if (disposed) return;
			const same = active?.id === sound.id && active.url === sound.previewUrl;
			stop();
			if (same) return;
			if (!sound.previewUrl) {
				reportFailure();
				return;
			}
			try {
				const audio = createAudio(sound.previewUrl);
				const entry = {
					id: sound.id,
					url: sound.previewUrl,
					audio,
					ended: () => {
						if (active === entry) stop();
					},
					failed: () => {
						if (active === entry) {
							stop();
							reportFailure();
						}
					},
				};
				active = entry;
				audio.addEventListener("ended", entry.ended);
				audio.addEventListener("error", entry.failed);
				onChange(sound.id);
				void audio.play().catch(entry.failed);
			} catch {
				stop();
				reportFailure();
			}
		},
		stop,
		retain: (sounds: readonly SoundPreviewSource[]) => {
			if (
				active &&
				!sounds.some(
					(sound) => sound.id === active?.id && sound.previewUrl === active.url,
				)
			)
				stop();
		},
		dispose: () => {
			disposed = true;
			stop();
		},
	};
}
