# Atlas

Atlas draws how a software project fits together — the apps, the database, the server, the outside services, and the wires between them — and lets you rearrange it like a board game. Wires that can't work are refused with a buzz and a plain-words reason.

## Run it

```sh
npm install
npm run dev     # http://localhost:4520
```

Atlas starts empty. Choose **Import a project…** and point it at a folder on your computer or one of your GitHub repositories (a token is needed for private repos), or start a blank map and draw it yourself.

## What it reads

- **Only what you point it at.** A local folder, or a GitHub repository read straight from GitHub. It never fetches other URLs.
- **Never secret values.** From env files it reads key names only, to know which services a project uses.
- **Your maps stay with you.** Saved maps go to `data/` (git-ignored) and to your browser's storage. Nothing is uploaded.

The project picker marks where each project lives: green on this computer, blue on GitHub, violet both.

## Play and Build

Atlas opens in **Play**: the way to understand a system without knowing the jargon.

- **Missions** on the left: small things to do on the map ("Find where the data lives", "Follow a wire", "Spot the trouble"). Each one teaches one idea and earns XP; the ring fills as you go.
- **Play the story**: the whole system one step at a time, in plain words. The piece or wire of each step lights up, everything else fades. Back, Next, or Auto; the voice reads along if it is on.
- **Cards**: click any piece or wire and the card on the right says what it is, how it is doing (Working / Needs attention / Cannot work / Planned) and who it talks to. Technical rows are one click away.
- **Quick guide** on first run, in four cards.

**Build** is the full toolset: add blocks, draw wires, Suggest, Tidy, save, versions, import. Two of the missions send you there on purpose.

Progress is kept per system in this browser.

## Views

- **Board** — 3D pieces in lanes (clients, servers, platform, data, outside), with live wires carrying light.
- **Map** — the same system flat, for editing.
- **Suggest** proposes missing wires; **Tidy** lays pieces out by role; **Explain** gives a spoken tour (uses a local [Kokoro](https://github.com/remsky/Kokoro-FastAPI) server on port 8880 if running, otherwise the browser's voice); **Export the tour** makes a printable report.

## Stack

Vite, React 18, TypeScript, react-three-fiber. The dev server (see `vite.config.ts`) provides the save, import and scan endpoints; a production build is view-only.
