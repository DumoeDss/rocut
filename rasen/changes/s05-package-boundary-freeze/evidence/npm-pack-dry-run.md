# `npm pack --dry-run` — task 2.5

Verifies the assumption B1's pack-and-install harness (owned by P3, reused by P6) rests on:
`"private": true` blocks `npm publish` but does not block `npm pack`. Recorded rather than carried
as belief. Run 2026-08-13 on `feat/s05-community-beta`, from repo root, one workspace at a time.

Command used per package: `npm pack --dry-run --workspace="packages/<name>"`

## `@opencut/editor-ports`

```
npm notice
npm notice 📦  @opencut/editor-ports@0.1.0
npm notice Tarball Contents
npm notice 543B package.json
npm notice Tarball Details
npm notice name: @opencut/editor-ports
npm notice version: 0.1.0
npm notice filename: opencut-editor-ports-0.1.0.tgz
npm notice package size: 366 B
npm notice unpacked size: 543 B
npm notice shasum: d14855f9a772887b7e74de8a82d19d1d8195a758
npm notice integrity: sha512-7I4Ky1P07COKX[...]Dox3Mt0ue2Njw==
npm notice total files: 1
npm notice
opencut-editor-ports-0.1.0.tgz
```

## `@opencut/editor-contracts`

```
npm notice
npm notice 📦  @opencut/editor-contracts@0.1.0
npm notice Tarball Contents
npm notice 894B package.json
npm notice Tarball Details
npm notice name: @opencut/editor-contracts
npm notice version: 0.1.0
npm notice filename: opencut-editor-contracts-0.1.0.tgz
npm notice package size: 446 B
npm notice unpacked size: 894 B
npm notice shasum: caf1817dc0768a9a5478b07739bb2c43aafefac8
npm notice integrity: sha512-SxmSoyH8XVALJ[...]Sn//MoYupWnGg==
npm notice total files: 1
npm notice
opencut-editor-contracts-0.1.0.tgz
```

## `@opencut/editor-classic`

```
npm notice
npm notice 📦  @opencut/editor-classic@0.1.0
npm notice Tarball Contents
npm notice 1.1kB package.json
npm notice Tarball Details
npm notice name: @opencut/editor-classic
npm notice version: 0.1.0
npm notice filename: opencut-editor-classic-0.1.0.tgz
npm notice package size: 501 B
npm notice unpacked size: 1.1 kB
npm notice shasum: 16e6fae189036d461004795ac8b085040cfdfa2f
npm notice integrity: sha512-405DoxpPOoGVK[...]rcEXeT68CsSzw==
npm notice total files: 1
npm notice
opencut-editor-classic-0.1.0.tgz
```

## Reading

All three pack cleanly with `total files: 1` — only `package.json` is included, because
`packages/*/src` is empty at this commit (P0 moves no source) and `README.md` / `LICENSE` /
`NOTICE` are declared in `files` but not yet written (design D8: "the last two are declared
empty-handed on purpose — P7 owns the bytes"). `npm pack` does not error on a `files` glob that
matches nothing; it simply packs what exists. `"private": true` produced no warning or refusal at
any point — it only affects `npm publish`, exactly as B1 assumed.
