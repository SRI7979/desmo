# Desmo

A Next.js starter for an SAT Math strategy tool. The current app displays **Desmo** on a blank page. Problem uploads, AI strategy selection, and an embedded Desmos calculator are future work.

## Run locally

```sh
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No API keys are needed to run the starter.

## API keys

`.env.local` is ready for your keys and is ignored by Git. `.env.example` provides the same empty placeholders for a fresh checkout; copy it to `.env.local` if that file is missing.

```dotenv
OPENAI_API_KEY=
NEXT_PUBLIC_DESMOS_API_KEY=
```

These placeholders are not connected to the app yet. Keep the AI key server-side: never give it a `NEXT_PUBLIC_` prefix. The Desmos key is intended for the browser calculator integration. Next.js exposes variables with a `NEXT_PUBLIC_` prefix to browser code; see the [environment variable documentation](https://nextjs.org/docs/app/guides/environment-variables). Restart the development server after changing keys.

## Files

- `src/app/page.tsx`: the starter page.
- `src/app/layout.tsx`: the shared page layout and metadata.
- `src/app/globals.css`: global styles.
- `src/app/page.module.css`: page-specific styles.
- `src/content/desmos-tricks.md`: a place to paste your existing SAT Desmos tricks; the app does not read this file yet.
- `.env.example`: empty API key template.
- `.env.local`: your local API keys; do not commit this file.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run build` | Create a production build. |
| `npm start` | Serve the production build after building. |
| `npm run lint` | Check code with ESLint. |
| `npm run typecheck` | Check TypeScript types. |
