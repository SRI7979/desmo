# v0 UI integration screenshots

Reference: `SRI7979/desmo-3f`, branch `v0/refine-button-weights`, commit `5a54709`.

Captured at 1242×892 (desktop) and 390×844 (mobile). The first set compares the source and destination in the same empty-workspace state, in both themes.

| Viewport | Theme | Source | Destination |
| --- | --- | --- | --- |
| 1242×892 | Light | ![Source, desktop light](source-empty-desktop-light.png) | ![Destination, desktop light](destination-empty-desktop-light.png) |
| 1242×892 | Dark | ![Source, desktop dark](source-empty-desktop-dark.png) | ![Destination, desktop dark](destination-empty-desktop-dark.png) |
| 390×844 | Light | ![Source, mobile light](source-empty-mobile-light.png) | ![Destination, mobile light](destination-empty-mobile-light.png) |
| 390×844 | Dark | ![Source, mobile dark](source-empty-mobile-dark.png) | ![Destination, mobile dark](destination-empty-mobile-dark.png) |

The seeded solved example in the source is a prototype. Destination solved-state screenshots use the real explanation, route selector, calculator, and account components with a temporary local fixture; no model request was made, and the fixture route was removed before the production build. The fixture uses a short quadratic so the answer, method stats, calculator rows, and tracing affordances fit in the captures.

| Viewport/state | Source prototype | Destination components |
| --- | --- | --- |
| Desktop, light, solved | ![Source solved, desktop light](source-solved-desktop-light.png) | ![Destination solved, desktop light](destination-solved-desktop-light.png) |
| Desktop, dark, solved | ![Source solved, desktop dark](source-solved-desktop-dark.png) | ![Destination solved, desktop dark](destination-solved-desktop-dark.png) |
| Mobile, light, solved | ![Source solved, mobile light](source-solved-mobile-light.png) | See mobile empty comparison above; the mobile explanation panel uses the same live components. |
| Mobile, dark, solved | ![Source solved, mobile dark](source-solved-mobile-dark.png) | ![Destination solved, mobile dark](destination-solved-mobile-dark.png) |

The final mobile checks cover the calculator panel, its full-screen overlay, and the profile menu:

- ![Calculator panel on mobile](destination-calculator-mobile-dark.png)
- ![Calculator full-screen overlay on mobile](destination-calculator-fullscreen-mobile-dark.png)
- ![Profile menu on mobile](destination-account-menu-mobile-dark.png)

Screenshot-only identity masking replaced the local account name and avatar with “Demo Student” and initials. The source’s weekly-goal panel and “Desmos first” switch are prototype-only; the destination keeps its real navigation, account, and calculator behavior. The source trial-key notice is absent from the destination because it uses the app’s configured Desmos key.
