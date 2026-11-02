# Longview logo guidelines

## 1. The logo

**Idea:** The sun setting over a `---`. Markdown's horizontal rule, promoted to landscape.

| Version | File | Use |
|---|---|---|
| Horizontal (primary) | `source/longview-horizontal.svg` | Headers, README, website |
| Stacked | `source/longview-stacked.svg` | Square spaces, splash, about box |
| Symbol | `source/longview-symbol.svg` | 24 px and larger |
| Symbol, small cut | `source/longview-symbol-small.svg` | 16 to 23 px. Pixel-snapped to a 16 px grid. |
| Wordmark | `source/longview-wordmark.svg` | Where the symbol is already present |

- One-colour and reversed versions are in `symbol/` and `lockups/`, as SVG plus PNG.
- The app icon is `symbol/longview-symbol-app-icon.svg`, with PNGs at 64, 512 and 1024.
- The web icon set is in `web/`: `favicon.svg`, `favicon.ico`, PNGs and `site.webmanifest`. Copy `head-snippet.html` into the page `<head>`.
- `favicon.svg` switches to paper in dark browser themes. The PNG and ICO files are always olive.

## 2. Construction

- Grid: 256 units.
- The rule is three equal dashes, each 58 × 20 units, with 21-unit gaps. It spans x 20 to 236.
- The sun is a half-disc with a 64-unit radius, centred on x 128. Its flat base sits 16 units above the rule.
- In the horizontal lockup, the bottom of the rule sits on the wordmark baseline and the top of the sun meets the ascender of the `l`.
- `source/build.py` regenerates every master: `python build.py <out-dir>` (needs `fonttools`).

## 3. Clear space

Keep **1 × S** clear on every side, where **S** is the height of the sun. The clear space scales with the logo.

## 4. Minimum size

| Version | Screen | Print |
|---|---|---|
| Horizontal | 120 px wide | 30 mm wide |
| Stacked | 64 px wide | 16 mm wide |
| Symbol | 24 px | 6 mm |
| Symbol, small cut | 16 px | 4 mm |

## 5. Colour

| Name | Role | HEX | RGB | CMYK (starting point) |
|---|---|---|---|---|
| Olive | Logo colour | `#465032` | 70 80 50 | 12 0 37 69 |
| Paper | Background, reversed logo | `#F7F0DF` | 247 240 223 | 0 3 10 3 |
| Ink | Dark background | `#332E26` | 51 46 38 | 0 10 25 80 |
| Lamplight | Accent, dark themes only | `#C7A57E` | 199 165 126 | 0 17 37 22 |

- These are the app's own colours. The CMYK values are a direct conversion, so proof them before printing. Pantone matches have not been picked: choose them from a physical swatch book.
- Olive on paper has a contrast ratio of 7.5:1. Paper on ink has 11.8:1.

**Approved pairs:**
- olive on paper
- paper on olive
- paper on ink
- black on white
- white on black

Never put olive on ink: it disappears.

## 6. Typography

- The wordmark is Young Serif, converted to outlines, with hand-set spacing. Never retype it. The font is under the SIL Open Font License; the licence is in `source/font/OFL.txt`.
- The app interface keeps the system UI font.

## 7. Don'ts

- Don't stretch, rotate or recolour the logo outside the palette.
- Don't add shadows, outlines or gradients.
- Don't add a fourth dash. The joke only works with three, as in `---`.
- Don't move the sun off centre or close the gap between the sun and the rule.
- Don't use the full symbol below 24 px. Use the small cut.
- Don't put the logo on a busy image without a paper or olive container.

## 8. Not done

- No trademark search has been done. Get a professional search before launch.
- The Tauri icons in `src-tauri/icons` are generated from `symbol/longview-symbol-app-icon.svg`. The app header uses the horizontal olive lockup.
