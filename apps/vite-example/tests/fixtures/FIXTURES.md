# Parity fixture media

Every file in this directory is **generated locally by FFmpeg from synthetic sources** — solid colour
fields and sine tones produced by FFmpeg's own `lavfi` inputs. None of it is sourced, sampled or
derived from third-party media, so there is no upstream licence, model release or attribution
attached to any of it and it can be redistributed with this repository without qualification.

Generated with `ffmpeg version 6.0-full_build` (`gyan.dev`), 2026-07-30.

## The files

| File | Content | Properties |
| --- | --- | --- |
| `fixture-image.png` | Solid `#3B82F6` field | 320×180, PNG, 628 B |
| `fixture-video.mp4` | Solid `#EF4444` field, silent | 640×360, H.264 baseline / yuv420p, **5.000 s @ 30 fps**, no audio track, 4,445 B |
| `fixture-tone-a4.wav` | 440 Hz sine (A4) | PCM s16le, 44,100 Hz, mono, **2.000 s**, 176,478 B |
| `fixture-tone-a5.wav` | 880 Hz sine (A5) | PCM s16le, 44,100 Hz, mono, **3.000 s**, 264,678 B |

The two tones differ in both frequency and duration deliberately: the parity snapshot compares clip
durations per track, so two audio clips of identical length would not distinguish a track-assignment
error from a correct placement.

## Generation commands

Run from this directory. Each is self-contained — no input file exists anywhere on disk beforehand.

```sh
ffmpeg -y -f lavfi -i color=c=0x3B82F6:s=320x180 -frames:v 1 fixture-image.png

ffmpeg -y -f lavfi -i color=c=0xEF4444:s=640x360:r=30 -t 5 \
  -c:v libx264 -pix_fmt yuv420p -profile:v baseline -an fixture-video.mp4

ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2" -ar 44100 -ac 1 -c:a pcm_s16le fixture-tone-a4.wav
ffmpeg -y -f lavfi -i "sine=frequency=880:duration=3" -ar 44100 -ac 1 -c:a pcm_s16le fixture-tone-a5.wav
```

`-profile:v baseline -pix_fmt yuv420p` is not incidental: the editor decodes video in the browser
through mediabunny/WebCodecs, and baseline yuv420p is the profile every browser decoder accepts.

## Hashes of the committed copies

```
65711ed348f99b7b2125d526cef3d49e9346301e5bf0df19a1aa755631d11566  fixture-image.png
15e391953079777b33c5f0e716a8d762f94433f01b97a612c861c7696fb5c204  fixture-video.mp4
25913a61558fb360d18633962fe6e568e10d0c510f31d7b4f65603e2671bb80d  fixture-tone-a4.wav
e91896f62e36ea35ff62173f34f759dc0083af98ca4c6da0bbe10dd29e4bddea  fixture-tone-a5.wav
```

These record what the parity runs actually used. Re-running the commands on a different FFmpeg or
libx264 build will produce media with **the same properties but different bytes** (encoder version
strings and rate-control details land in the file), so treat a hash mismatch after regeneration as
expected, and the property table above as the contract.
