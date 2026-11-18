# Staging — songs in progress

Put MusicXML transcriptions here while they are still being prepared, checked, or cleaned up.
Everything in this directory except this README is gitignored, so large or unfinished scores stay
local and do not appear in `docs/REPO_MAP.md`.

- Keep personal transcriptions here or outside the checkout. Root `tunes/*.musicxml`, `*.xml`
  and `*.mxl` files are also ignored; users import their own scores in the app.
- Shared test/demo scores must be original or have an explicit redistribution license. Keep
  small rights-cleared fixtures with their tests and record their provenance.
- Keep one-off parser scripts here too. Avoid `*.test.*` names so the normal test suite does
  not collect local checks or depend on personal scores.
