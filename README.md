# Teletext Workshop

A small React app for a workshop on **nostalgia and digital communication before the web**. Users can create and share their own **teletext pages** in a 40×24 grid with period-accurate colors and aesthetics.

## What is teletext?

Teletext was a text-based information system broadcast in the vertical blanking interval of TV signals (1970s–1990s). Pages were 40 characters wide by 24 rows, with a limited color palette (black, red, green, yellow, blue, magenta, cyan, white) and block graphics.

## Features

- **Editor**: Create a page by clicking cells and typing. Use the color pickers for foreground and background. Arrow keys move the cursor; Backspace/Delete clear.
- **Share**: Click “Share” to update the URL with the current page and copy the link. Anyone opening the link sees the page in read-only **viewer** mode.
- **Edit a copy**: In the viewer, “Edit a copy” loads the same content into the editor and clears the URL so you can modify and share again.
- **Export PNG**: Download the current page as a PNG image (editor or viewer).

## Run locally

Uses [Bun](https://bun.sh) for install and scripts.

```bash
cd teletext-workshop
bun install
bun run dev
```

Open the URL shown (e.g. http://localhost:5173).

## Build

```bash
bun run build
```

Output is in `dist/` (static files).

## Deploy to Vercel

1. **Create a GitHub repo** and push this project (see below).
2. In [Vercel](https://vercel.com), **Import** the GitHub repo. Set the **Root Directory** to the project folder (e.g. `teletext-workshop` if the repo only contains this app).
3. **Build**: Vercel will detect Vite; build command `npm run build` (or `bun run build`), output `dist`. The `api/` folder is deployed as serverless functions.
4. **Optional – persistence**: To save pages (100–900) across visits, add **Redis** from the [Vercel Marketplace](https://vercel.com/marketplace?category=storage) (Storage). Connect it to your project, run `vercel env pull .env.development.local` locally, and ensure `REDIS_URL` is set. Without Redis, pages use the file store in `/tmp` and do not persist on serverless.

## Tech

- **React 19** + **TypeScript** + **Vite 7**
- **React Router** for `/`, `/view?page=...`, `/edit/:pageNumber`
- **API** (`/api/pages`, `/api/pages/[number]`) for loading/saving pages; optional **Redis** (Marketplace, `redis` npm package) for persistence
- Teletext-style UI: 40×24 grid, index line (INDEX / TV GUIDE / WORLD / FINANCE), page number cycling animation
