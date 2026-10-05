# Saved maps

Your maps live here, one JSON per system, written by "Save to project" (⌘S) while the dev server runs. Atlas lists every map in this folder and loads it on start.

Nothing in this folder except this README is committed: the maps describe your own projects and stay on your computer.

`origins.json` (optional) tells the system picker where a map's project lives when its id is not the folder's name:

```json
{ "shop": "my-shop-v2", "site": "~/Code/site" }
```

Paths are relative to the folder that holds Atlas, or start with `~`.
