# Appearance integration comparisons

Verified source: [`SRI7979/desmo-3f`, `v0/refine-button-weights`, `669c3342066dcd11a3765006b14b1c45a0e60368`](https://github.com/SRI7979/desmo-3f/commit/669c3342066dcd11a3765006b14b1c45a0e60368). Both the commit API and cloned branch HEAD matched; no local fallback was used.

Default: **Tidal · Modern · Raised · Round · Light**. Saved Light/Dark preferences are retained. Explicit System preferences now persist too; the old implementation removed its storage key for System, so a missing key has no recoverable saved preference and uses the requested Light default. New palette/typography/button/corner choices use sessionStorage only. Reset restores the requested defaults, including Light (the prototype resets its four style choices only).

The source palette definitions, fonts, tokens, dialog structure, sizing, and interaction styles are ported into the real app. The existing theme provider replaces next-themes; existing Tailwind and Lucide dependencies suffice. No prototype backend, simulated solving, fake progress, or mock account data is shipped. Scoped workspace tokens also adapt the real history, saved tricks, and Settings pages; landing/auth styling is not replaced. Geist, Geist Mono, and STIX font variables are shared without changing unrelated pages' font families.

## Requested comparisons

Both applications use the empty workspace and the initial Appearance dialog, at identical viewports and light/dark states. The dialog is scrollable: lower controls/footer remain accessible even when below the initial capture.

| State | Source | Destination |
| --- | --- | --- |
| 836×892, light, workspace | ![Source](source-desktop-light-workspace.png) | ![Destination](destination-desktop-light-workspace.png) |
| 836×892, light, appearance | ![Source](source-desktop-light-appearance.png) | ![Destination](destination-desktop-light-appearance.png) |
| 836×892, dark, workspace | ![Source](source-desktop-dark-workspace.png) | ![Destination](destination-desktop-dark-workspace.png) |
| 836×892, dark, appearance | ![Source](source-desktop-dark-appearance.png) | ![Destination](destination-desktop-dark-appearance.png) |
| 390×844, light, workspace | ![Source](source-mobile-light-workspace.png) | ![Destination](destination-mobile-light-workspace.png) |
| 390×844, light, appearance | ![Source](source-mobile-light-appearance.png) | ![Destination](destination-mobile-light-appearance.png) |
| 390×844, dark, workspace | ![Source](source-mobile-dark-workspace.png) | ![Destination](destination-mobile-dark-workspace.png) |
| 390×844, dark, appearance | ![Source](source-mobile-dark-appearance.png) | ![Destination](destination-mobile-dark-appearance.png) |

The dialog bounding boxes, font families, and backgrounds match at all four requested viewport/theme combinations. Pixel comparison of the inner dialog crop found fewer than 0.03% of pixels differing by more than 12/255 per channel; this excludes the different live-app content behind the backdrop and is not a whole-workspace identity claim.

## Sidebar and real method controls

836px is below the source's 1024px sidebar breakpoint, so additional 1242×892 captures check the desktop sidebar. Destination identities are local test fixtures (Demo Student), not real user data.

| Theme | Source | Destination |
| --- | --- | --- |
| light | ![Source](source-sidebar-light-workspace.png) | ![Destination](destination-sidebar-light-workspace.png) |
| dark | ![Source](source-sidebar-dark-workspace.png) | ![Destination](destination-sidebar-dark-workspace.png) |

The real method picker/explanation/calculator components were additionally rendered with a local quadratic fixture (x² = 9), without model requests. Method tab switching and Appearance controls passed on both sizes. These screenshots demonstrate the real method components; the prototype's sample problem differs.

| Viewport | Light | Dark |
| --- | --- | --- |
| 836×892 | ![Light](destination-desktop-light-methods.png) | ![Dark](destination-desktop-dark-methods.png) |
| 390×844 | ![Light](destination-mobile-light-methods.png) | ![Dark](destination-mobile-dark-methods.png) |

## Intentional differences

- The app keeps real route navigation, profile/settings/sign-out behavior, its mobile navigation, and its original Desmo glyph. The wordmark size, lower-case treatment, and palette follow the source.
- Source's fake weekly goal, SAT date, and simulated solving-mode menu are omitted. The app retains real method statistics, verification/error states, tutor and saved-trick functionality.
- The real upload limit remains 8 MB; the prototype advertises 10 MB. Upload/sample handlers remain real.
- The graph retains the configured Desmos API key and existing default bounds. The source's trial-key warning and sample viewport are not imported. Appearance changes keep calculator expression colors independent and preserve entered rows/bounds.
- Reset includes Light per the requested defaults; existing theme preferences are otherwise preserved.

## Validation

- TypeScript, lint, production build, and all 387 offline tests passed.
- Browser checks: all six palettes; all nine style choices; computed font families, radius values, and button treatments; Light/Dark/System and live OS changes; reset, native modal dismissal/footer; session reload/navigation; fresh-session defaults; existing saved Dark; no horizontal overflow or page errors.
- A real Desmos instance was instrumented locally: entered expressions and graph bounds were unchanged across appearance choices, and the instance was not recreated.
- Saved Dark colors were verified before hydration by blocking client JavaScript chunks while allowing the inline theme initializer.
- Temporary screenshot fixture routes were removed before the final build and commit. No live AI solve requests or production account mutations were made.

A branch-specific `vercel.json` disables automatic Git deployments for `feature/tidal-appearance-669c334` only, using [Vercel's documented branch control](https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled). This PR is not merged or deployed.
