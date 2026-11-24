# Content and asset provenance

Project-owned code, documentation, original music and visual assets are licensed under the
[GNU Affero General Public License version 3 only](LICENSE), SPDX identifier `AGPL-3.0-only`.

| Material | Provenance | License scope |
| --- | --- | --- |
| `src/assets/water-texture.webp`, `src/assets/leaf-texture.webp` | Derived from original photographs owned by the project owner. | AGPL-3.0-only, included with the project. |
| `src/assets/pond-swirl.webp`, `src/assets/pond-marble.webp`, `src/assets/pond-neon.webp`, `src/assets/pond-bands.webp`, `src/assets/pond-abyss.webp`, `src/assets/pond-bloom.webp`, `src/assets/pond-current.webp` | Derived from original pond photographs owned by the project owner (the same series as the water texture): cropped, scaled to 960×1280, lightly denoised. | AGPL-3.0-only, included with the project. |
| Instrument dial in `src/components/PracticeAtmosphere.tsx`, spiral algae-morph shader in `src/components/RenderedWater.tsx` and interactive shell backdrop in `src/components/AbyssalWater.tsx` | Original project SVG and WebGL spiral-morph shaders reusing the existing `pond-*.webp` and `water-texture.webp` photographs above; no third-party rendering assets, code or textures added. | AGPL-3.0-only. |
| Living pool shaders and engine in `src/pool/engine/` | Original project code written from the published stable-fluids method (Stam, 1999; GPU Gems ch. 38); no third-party shader code. Floating leaves reuse regions of the existing `water-texture.webp`; the pond turns between it and the `pond-*.webp` photographs above. | AGPL-3.0-only. |
| `public/icon.svg` and its PNG exports | Original project fretboard icon. | AGPL-3.0-only. |
| First Steps in `src/tunes/starter.ts` | Original eight-bar C major melody and separated two-beat guitar-chord accompaniment written for this app; no third-party score or recording used. | AGPL-3.0-only, including the downloadable score. |
| Blue Hour in `src/tunes/demos/blue-hour.musicxml` | Original 12-bar C jazz-blues melody and articulated three-note guitar shell accompaniment composed for this app; no third-party transcription, arrangement or recording used. | AGPL-3.0-only, including the downloadable score. |
| Study cues in `src/tunes/demos.ts` | Project-authored purpose, starting assumptions, optional fingering, listening cue, shorter entry and transfer task for each bundled arrangement. Source-reviewed; physical playability, recorded demonstration and teaching effectiveness are not yet play-tested. | AGPL-3.0-only. |
| Classical/traditional melodies in `src/song/reading.ts` | Public-domain melodies, represented by the project's scale-degree/rhythm encoding. | The project encoding is AGPL-3.0-only; the underlying public-domain music remains public domain. |
| `src/assets/fonts/*.woff2` | Unmodified Google Fonts web subsets: Fraunces v38, Inter v20 and JetBrains Mono v24; Latin and extended Latin. See `notices/font-assets.json` for exact URLs and hashes. | SIL Open Font License 1.1; separate copyright/OFL texts in `notices/fonts/google/`. |

Third-party libraries and fonts retain their original licenses. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for notices and license links. The project AGPL
does not replace those licenses.

No personal full-score transcriptions are bundled with the release source. Users import their
own MusicXML repertoire into persistent browser-local storage. Those files are separate from the
repository and app build. An import or device transfer does not grant new rights in a score or
relicense it under the app's AGPL. New shared fixtures must carry their source and redistribution
terms here.
