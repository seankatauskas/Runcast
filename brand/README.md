# Runcast production identity

This package owns the production Forward Terminals RC monogram used by Runcast mobile and web. `src/geometry.json` contains the exact unsimplified trace. `src/spec.json` locks its colors and optical rules. Run `npm run brand:generate` from the repository root after changing either source; generated app assets and `manifest.json` update together.

## Locked specification

- Brand teal: `#67D5D6`
- Brand black: `#050707`
- Master canvas: `1254 × 1254`
- Starting-dot outline: `10` master units
- Micro outline: `32` master units; only the ring changes, never the body or dot path
- Clear space: at least one starting-dot diameter (`77` master units)
- Standard mark minimum: `32px`
- Micro mark range: `16–31px`
- Wordmark: Space Grotesk Bold (`700`)

Use the primary mark and lockups on brand black. The transparent mark is for composition on brand black, not for recoloring over light surfaces. The knockout asset is the only tintable mark and is reserved for system-controlled monochrome treatments.

Official product artwork is flat. Do not add white fills, gradients, texture, lighting, depth, filters, or shadows. `notification-96.png` is the sole white-alpha exception because Android requires notification artwork in that format.

## Contents

- `src/runcast-rc-vector-master.svg`: preserved traced vector input for regenerating canonical geometry
- `svg/runcast-rc-master.svg`: clean, transparent canonical master
- `svg/runcast-rc-primary.svg`: teal and black primary mark
- `svg/runcast-rc-transparent.svg`: transparent-canvas mark
- `svg/runcast-rc-knockout.svg`: single-color system tint asset
- `svg/runcast-rc-micro.svg`: compact 16–31px mark
- `svg/runcast-lockup-*.svg`: horizontal and stacked Space Grotesk Bold lockups
- `png/platform/`: iOS, Android, splash, and notification sources
- `png/web/`: favicon sizes
- `png/ui/`: common 1×/2×/3× UI exports
- `preview/index.html`: standard, micro, platform-mask, splash, and lockup review page
- `manifest.json`: dimensions, roles, byte sizes, and SHA-256 checksums for every generated output

## Mobile component

`RuncastMark` in `apps/mobile/src/design/RuncastMark.tsx` is generated from the same canonical paths. It supports `size`, `background`, `markColor`, `dotColor`, `dotOutlineColor`, `dotOutlineWidth`, `micro`, and `accessibilityLabel`. Its defaults are the locked specification.

The Explorer menu uses the micro framing without changing the original 44pt button or traced dot geometry. Its control surface and dot center follow the current card color.

## Verification

```sh
npm run brand:generate
npm run brand:validate
```

Validation checks checksums, required dimensions and alpha behavior, source path identity, the 10-unit master ring, the strengthened micro ring, brand colors, and the absence of forbidden SVG effects and white pixels. Open `brand/preview/index.html` through any static server for visual review.
