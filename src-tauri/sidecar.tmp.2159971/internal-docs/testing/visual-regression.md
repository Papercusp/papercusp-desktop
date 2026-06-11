# Visual regression — Storybook + Lost Pixel
URL: /internal/docs/testing/visual-regression



import { Aside } from '@astrojs/starlight/components';

This page is the operational guide to Phase 4 of the testing framework
(see [`testing/index`](./index)). Stories are the test cases; a
diff against the committed baseline is the assertion.

## TL;DR

```bash
# Local — verify your branch hasn't drifted
npm run lostpixel --workspace libs/generic/ui-primitives

# Local — regenerate baselines (intentional change only)
npm run lostpixel:update --workspace libs/generic/ui-primitives

# CI — runs automatically on `run-visual` PR label or push to main
```

## What's covered today

| Package                      | Stories      | Baselines | Storybook port |
| ---------------------------- | ------------ | --------- | -------------- |
| `libs/generic/ui-primitives` | 6 components | 33 PNGs   | `:6006`        |
| `libs/marketplace-public-ui` | 3 components | 14 PNGs   | `:6007`        |
| `libs/agent-chat`            | 2 components | 7 PNGs    | `:6008`        |
| `apps/operator`              | 3 components | 10 PNGs   | `:6009`        |

## Adding a story

1. **Drop a `Foo.stories.tsx` next to `Foo.tsx`** in any `libs/*/src/`
   that has Storybook wired:

   ```tsx
   import type { Meta, StoryObj } from '@storybook/react-vite';
   import { Foo } from './Foo';

   const meta: Meta<typeof Foo> = { component: Foo };
   export default meta;

   export const Default: StoryObj<typeof Foo> = {};
   export const WithTone: StoryObj<typeof Foo> = { args: { tone: 'good' } };
   ```

2. **Verify it renders** — `npm run storybook --workspace libs/<lib>`
   and visit the port shown above.

3. **Generate the baseline** — `npm run build-storybook --workspace libs/<lib>`
   then `npm run lostpixel:update --workspace libs/<lib>`. PNGs land in
   `lostpixel-baseline/`. **Commit them.**

4. **Verify clean** — `npm run lostpixel --workspace libs/<lib>`. Should
   exit 0 with all stories within threshold.

## Adding Storybook to a new lib

If you're stand­ing up Storybook for the first time in a lib:

```bash
npm install --save-dev --workspace libs/<lib> \
  storybook @storybook/react-vite @storybook/addon-docs lost-pixel \
  --legacy-peer-deps --ignore-scripts
```

Then create the four required files (copy from `libs/ui-primitives`):

* `.storybook/main.ts` — story glob + framework
* `.storybook/preview.ts` — backgrounds + global CSS imports
* `lostpixel.config.ts` — paths + threshold
* `.gitignore` additions: `storybook-static/`, `lostpixel-current/`, `lostpixel-diff/`

Add four scripts to `package.json`:

```json
"storybook": "storybook dev -p 6008",
"build-storybook": "storybook build -o storybook-static",
"lostpixel": "lost-pixel",
"lostpixel:update": "LOST_PIXEL_GENERATE_ONLY=1 lost-pixel"
```

Pick a unique port per lib (`6006` ui-primitives, `6007` marketplace-public-ui,
`6008+` for new ones). Wire the new lib into the `visual` job in
`.github/workflows/test.yml` so CI covers it.

The repo's main Playwright is `1.59.1`, but Lost Pixel ships its own
older copy. The CI workflow installs Chromium for that copy via
`node node_modules/lost-pixel/node_modules/playwright-core/cli.js install chromium`.
Locally the same command runs on first use.

## When a baseline diff is reported

Two cases:

1. **Intentional UI change** — eyeball the diff (`lostpixel-diff/`), confirm
   the new render is what you wanted, then `npm run lostpixel:update` and
   commit the new `lostpixel-baseline/` PNG. The CI run on your PR will
   then exit 0.

2. **Unintentional regression** — read the diff, fix the bug. Don't
   regenerate the baseline.

The threshold is `0.05` (5%); small antialiasing wobble below that
won't flag. If you find yourself wanting to bump the threshold,
something is probably wrong — investigate the wobble first.

## What gets baselined vs ignored

`.gitignore` per lib:

* ✅ **`lostpixel-baseline/`** — committed (the test fixtures).
* ❌ `lostpixel-current/` — per-run output, ignored.
* ❌ `lostpixel-diff/` — per-run output, ignored.
* ❌ `storybook-static/` — per-run build, ignored.

When the global PNG count grows past \~50, the spec (§1.11) calls for
git-lfs to keep the repo light. Until then, direct-commit is simpler
and avoids any LFS-bandwidth surprises in CI.

## CI behavior

The `visual` job in `.github/workflows/test.yml`:

* Runs on PRs **only** when the `run-visual` label is applied (matches
  the spec §1.11 opt-in pattern), and on every push to `main`.
* Builds Storybook + runs Lost Pixel for each wired lib in sequence.
* Uploads `lost-pixel-diffs` artifact on failure (combined `current/`
  and `diff/` from every lib).

To auto-apply `run-visual` when story files touch, add a CODEOWNERS
or labeler workflow rule for `libs/**/*.stories.@(ts|tsx)` (not yet
wired — open follow-up).

## Related

* [Testing framework spec v1.1](./index)
* [Agent E2E reference](./agent-e2e)
