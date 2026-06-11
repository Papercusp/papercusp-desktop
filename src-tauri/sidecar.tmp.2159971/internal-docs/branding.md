# Branding
URL: /internal/docs/branding

Visual identity assets, token packs, icon exports, and flag-gated The Swarm usage.

import { Aside } from '@astrojs/starlight/components';

Papercusp currently has two visual identity layers:

* **Classic Papercusp** is the default product identity and remains the active skin when `papercusp-the-hive` is off.
* **The Swarm** is a flag-gated visual layer for the bee lexicon and swarm-intelligence direction. It changes presentation assets, theme tokens, favicon, and labeled nouns only; it does not rename code identifiers, database rows, or tools.

The flag-on product-facing name is **The Swarm**. The implementation pack id remains `the-hive` for reversibility and because the user creates or joins a **Hive**; inside a Hive, many **Swarms** can run.

## Classic Identity

Classic assets stay in their existing locations and must not be overwritten by Hive work:

| Surface                     | Path                                                       |
| --------------------------- | ---------------------------------------------------------- |
| Operator logo component     | `apps/operator/app/_components/OperatorLogoMark.tsx`       |
| Operator wordmark component | `apps/operator/app/_components/OperatorWordmarkLockup.tsx` |
| Operator favicon/icon       | `apps/operator/app/icon.svg`                               |
| Public wordmark             | `apps/operator/public/wordmark.svg`                        |
| Desktop icon set            | `papercusp-desktop/src-tauri/icons/`                       |

## The Swarm Identity

The Swarm direction is engineered swarm intelligence: honey-amber signal color on charcoal, precise hex geometry, a primary bee-swarm mark for the app, and a distinct Queen mark for the brain.

| Asset                   | Path                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| Primary mark            | `apps/operator/public/brand/the-hive/primary-mark.svg`                                                    |
| Primary monochrome mark | `apps/operator/public/brand/the-hive/primary-mark.mono.svg`                                               |
| Queen mark              | `apps/operator/public/brand/the-hive/queen-mark.svg`                                                      |
| Queen monochrome mark   | `apps/operator/public/brand/the-hive/queen-mark.mono.svg`                                                 |
| Wordmark                | `apps/operator/public/brand/the-hive/wordmark.svg`                                                        |
| Wordmark lockup         | `apps/operator/public/brand/the-hive/wordmark-lockup.svg`                                                 |
| Favicon                 | `apps/operator/public/brand/the-hive/favicon.svg` and `favicon.png`                                       |
| Comb motif              | `apps/operator/public/brand/the-hive/comb-motif.svg`                                                      |
| Lexicon icons           | `apps/operator/public/brand/the-hive/icons/*.svg`                                                         |
| Desktop icon pack       | `papercusp-desktop/src-tauri/icons/the-hive/` and `libs/papercusp/apps/desktop/src-tauri/icons/the-hive/` |
| React mark components   | `apps/operator/app/_components/HiveVisualIdentity.tsx`                                                    |

## Runtime Behavior

The Swarm skin is selected by `FLAGS.THE_HIVE` / `papercusp-the-hive`.

* Logo components switch from the classic cup marks to The Swarm primary mark via `useLexiconPackId()`.
* `HiveThemeBridge` forces `data-theme="honeycomb"`, sets the title to `The Swarm`, and injects the Hive favicon while the flag is on.
* When the flag turns off, `HiveThemeBridge` restores the user’s saved active theme and the classic title.
* The selectable Honeycomb theme is generated from `design-tokens/honeycomb.semantic.tokens.json` into `apps/operator/app/_semantic.honeycomb.css`.
* The legacy `hive` selector remains as an implementation-pack alias; new runtime usage should prefer `honeycomb`.
* The Swarm desktop icons are parallel exports only. `tauri.conf.json` still points to the classic icon set until packaging explicitly opts into the Swarm pack.

## Lexicon

The flag-on nouns are presentation-only:

| Classic concept                    | Flag-on term |
| ---------------------------------- | ------------ |
| Project / deployable group         | Hive         |
| Live set of working agents         | Swarm        |
| Brain / high-judgment orchestrator | Queen        |
| Always-on operator                 | Sentinel Bee |
| AI agent                           | Bee          |
| Human member                       | Keeper       |
| Unit of work                       | Cell         |
| Shared store                       | Comb         |
| Machine / region                   | Frame        |
| Collaboration substrate            | Hive Mind    |

## Color Tokens

The Swarm token pack is dark-first and WCAG-oriented:

| Token          |     Value | Use                  |
| -------------- | --------: | -------------------- |
| Background     | `#050505` | app shell base       |
| Surface        | `#10100B` | cards and panels     |
| Raised surface | `#17130A` | elevated chrome      |
| Text           | `#FFF7DF` | primary foreground   |
| Muted text     | `#B9AA86` | secondary foreground |
| Primary accent | `#EAB308` | honey action color   |
| Strong accent  | `#FDE68A` | hover/highlight      |
| Accent ink     | `#130D03` | text on honey        |

Semantic colors remain distinct from the primary honey accent: success green, danger rose, info blue, and warning honey.

## Motif Rules

Use hexagons as layout structure, not wallpaper. The comb motif works for background texture, dividers, empty states, and swarm/loading states when it is low-contrast and aligned to the UI grid.

Do not use cartoon bees, playful yellow-on-white compositions, or random honeycomb decoration. The Swarm should feel like an engineered distributed system.

## Preview And Exports

* Preview the system at `/dev/operator-logo` in the operator app.
* Editable SVG and raster export notes live in `apps/operator/public/brand/the-hive/README.md`.
* Regenerate theme CSS with `npm run tokens` after editing token JSON.
* Rebuild docs with `cd apps/operator-docs && npm run build` after changing this page so `apps/operator/public/internal/docs/` is refreshed.
