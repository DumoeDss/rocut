import type { MediaAsset, MediaType } from "./types";

export const SUPPORTS_AUDIO: readonly MediaType[] = ["audio", "video"];

// File.type comes from the platform file picker, not the media bytes. Only
// fill an unspecified MIME; explicit types stay authoritative and every
// accepted file still goes through the normal decoder before publication.
const PICKER_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	mp4: "video/mp4",
	mov: "video/quicktime",
	mkv: "video/x-matroska",
	webm: "video/webm",
	wav: "audio/wav",
	mp3: "audio/mpeg",
	flac: "audio/flac",
	ogg: "audio/ogg",
	opus: "audio/ogg",
	m4a: "audio/mp4",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
};

function getPickerMimeType({ file }: { file: File }): string {
	if (file.type !== "" && file.type !== "application/octet-stream") {
		return file.type;
	}
	const extension = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase();
	return extension && Object.hasOwn(PICKER_MIME_BY_EXTENSION, extension)
		? PICKER_MIME_BY_EXTENSION[extension]
		: file.type;
}

export function normalizeMediaFile({ file }: { file: File }): File {
	const type = getPickerMimeType({ file });
	return type === file.type
		? file
		: new File([file], file.name, { type, lastModified: file.lastModified });
}

export function mediaSupportsAudio({
	media,
}: {
	media: MediaAsset | null | undefined;
}): boolean {
	if (!media) return false;
	return SUPPORTS_AUDIO.includes(media.type);
}

export const getMediaTypeFromFile = ({
	file,
}: {
	file: File;
}): MediaType | null => {
	const type = getPickerMimeType({ file });

	if (type.startsWith("image/")) {
		return "image";
	}
	if (type.startsWith("video/")) {
		return "video";
	}
	if (type.startsWith("audio/")) {
		return "audio";
	}

	return null;
};
