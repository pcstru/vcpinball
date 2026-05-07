# Pinball

Browser-based pinball with:
- `#play` for gameplay
- `#design` for table/object editing
- `#logic` for logic-only authoring

Current scope:
- Table schema, physics, rendering, objects, and editor tooling
- Feature-first logic authoring, validation, simulation, and rulesEngine export
- `table.features[]` as human-facing gameplay structure over the compiled rules

Notes:
- `#logicstudio` currently aliases to the same logic page as `#logic`.
- `rulesEngine` is supported for compatibility (`switchMap`, `sequenceRules`, `triggers`, `variables`, `logicGraphs`).
- The Design assistant UI is local-only in this static build; external AI execution and patch application are disabled.

Hosted table URL examples:
- `index.html#play&table=Egypt` loads `tables/Egypt.json`.
- `index.html#play&table=mtpb` loads `tables/mtpb.json`.
- `index.html?table=Egypt#play` also works (query params are merged into route params).

Image path rules for hosted table JSON:
- Use absolute URLs (`https://...`) or root paths (`/assets/bg.png`) when you want fixed locations.
- `tables/...` paths are app-relative (relative to `index.html` origin/path).
- Other relative paths (for example `bg.png` or `images/bg.png`) resolve relative to the loaded table JSON URL directory when available.
