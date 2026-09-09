# Workbench emblem asset

`public/3demblem.glb` is the original source model. Runtime components use
`public/3demblem-optimized.glb`, with identical material textures and a
conservative geometry error bound of 0.0001 of the model's extent.

The optimized asset uses Meshopt compression. Drei's existing GLTF loader
includes its decoder, so it needs no CDN request or new runtime dependency.
Both GLB files are tracked through Git LFS. The single-file build excludes
public assets and retains its self-contained static emblem.

Reproduce with [glTF Transform](https://gltf-transform.dev/cli), version 4.2.1:

```powershell
npx --yes @gltf-transform/cli@4.2.1 optimize public/3demblem.glb "$env:TEMP/emblem-geometry.glb" --compress quantize --simplify-ratio 0.15 --simplify-error 0.0001 --texture-compress false
npx --yes @gltf-transform/cli@4.2.1 meshopt "$env:TEMP/emblem-geometry.glb" public/3demblem-optimized.glb --level high
```

The ratio is a target, bounded by the error limit; preserving small details
takes priority over reaching that ratio. Measured output:

| | Original | Optimized |
| --- | ---: | ---: |
| File bytes | 40,914,396 | 13,948,292 |
| Rendered triangles | 1,024,416 | 575,248 |

Run `scripts/smoke-emblem.cjs` with the installed Electron executable from this
directory. It renders both assets with the same camera, lighting, and pixel
ratio, verifies nonempty renders and reduced triangle count, and writes PNG
comparisons to the temporary directory. Rendering timing is printed for
observation, not asserted: it depends on device, caching, and GPU scheduling.

To deliberately regenerate the launcher's transparent, model-rendered preview,
set `WRITE_EMBLEM_PREVIEW=1` for this script. It writes
`src/assets/emblem-preview.webp` from the rendered canvas. This small preview
appears immediately, then fades into the animated model after its first frame.
