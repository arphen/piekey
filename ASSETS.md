# Content and asset provenance

Project-owned code, documentation, original music and visual assets are licensed under the
[GNU Affero General Public License version 3 only](LICENSE), SPDX identifier `AGPL-3.0-only`.

| Material | Provenance | License scope |
| --- | --- | --- |
| `src/assets/water-texture.webp`, `src/assets/leaf-texture.webp` | Derived from original photographs owned by the project owner. | AGPL-3.0-only, included with the project. |
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
