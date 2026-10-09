export const ENGINE_VERSIONS = { hyperframes: "0.8.139", remotion: "4.0.440", three: "0.185.1" } as const;
export const HYPERFRAMES_TOOLCHAIN = { "@hyperframes/core": ENGINE_VERSIONS.hyperframes, acorn: "8.19.0" } as const;
export const REMOTION_TOOLCHAIN = { remotion: ENGINE_VERSIONS.remotion, react: "18.3.1", "react-dom": "18.3.1", esbuild: "0.27.3" } as const;
export const THREE_TOOLCHAIN = { three: ENGINE_VERSIONS.three, "@elftia/three-assets": "0.1.1", "@noble/hashes": "2.0.1", esbuild: "0.27.3" } as const;
