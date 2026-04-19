# Umwelt — instructions for Claude Code

You are working on the UI of **Umwelt**, an indie game where the player is a
researcher operating a macro-lens observation drone that follows insect
subjects in a chemical environment. The UI is *diegetic* — it represents a
real research drone + operator workstation, not a generic game HUD.

## the design source of truth

Two files in this folder are the canonical reference. Read both before
touching any UI code.

- **`design_tokens.md`** — colors, typography, scale, layout, components,
  hard constraints. Use the token names listed here as constants in code.
- **`umwelt_observation.html`** — five fully-rendered 1280×720 artboards
  (visible / IR / LiDAR / UV / GCaMP) sharing the same HUD skeleton + neural
  panel. Every component has a semantic class name (`.mode-btn`, `.reticle`,
  `.chem-overlay`, `.neural-panel`, `.gcamp-ant-pulse`, …). Match these
  names in code.

If a question about visual treatment is not answered by the tokens doc,
check the HTML — values like font sizes, exact positions, opacities,
animation timing, and SVG geometry are all in there.

## hard rules — these come up constantly, do not violate

1. **Casing.** All UI text is sentence case or lowercase. **No Title Case.
   No ALL CAPS, especially never with letter-spacing.** Units are lowercase
   (`mm`, `m`, `s`, `fps`, `iso`, `rh`).
2. **No neon, no scanlines, no datamosh.** This is a research workstation,
   not a sci-fi HUD.
3. **HUD stroke weight: 0.5–1 px** (1.5 px only for active connections in
   the neural panel). No thick borders.
4. **The subject is sacred.** UI never obscures the ant. The reticle frames
   it; nothing covers it.
5. **Photoreal renders never get UI styling applied to them.** The UI adds
   a thin data overlay on top of the camera feed; it does not stylize what
   the camera sees.
6. **Tokens, not literals.** Never hardcode `#F5F0E8` in a component — use
   the named token. If you need a value not in `design_tokens.md`, add it
   to the doc as part of the same change.
7. **The neural panel is identical across all five observation modes.** Node
   positions, connection topology, and cell labels do not change when the
   mode switches — it's the same CNS being observed through a different
   sensor. Only the camera-feed treatment changes.

## component naming

Match the class names in `umwelt_observation.html` exactly:

| reference class       | role                                                |
|-----------------------|-----------------------------------------------------|
| `.artboard`           | a full 1280×720 frame, owns `data-mode`            |
| `.scene-{mode}`       | the camera feed in a specific mode                  |
| `.mode-switcher`      | the top-left segmented control                      |
| `.mode-btn[.active]`  | one switcher button                                 |
| `.mode-badge`         | label + dot beneath the switcher                    |
| `.reticle`            | corner brackets around the subject                  |
| `.chem-overlay`       | grouped chemical washes (desaturates in IR/GCaMP)  |
| `.chem-callouts`      | distance leader lines for α/δ centers               |
| `.neural-panel`       | the full right-side workstation                     |
| `.gcamp-ant-pulse`    | applied to GCaMP-mode ant body for the 2.4 s pulse |

If a component does not exist in the reference, name it consistently with
the existing pattern (kebab-case, scope by area) before implementing.

## modes

The mode switcher swaps the camera feed's color treatment only. Modes:

`visible` · `ir` · `lidar` · `uv` · `gcamp`

When IR or GCaMP is active, the chemical overlay desaturates so it doesn't
fight the mode's primary palette.

## working with this UI

When asked to add or change a HUD element:

1. Open `umwelt_observation.html` and find the closest existing component.
2. Re-use its class name and visual conventions (stroke weight, font, casing).
3. If a new color is needed, add it to `design_tokens.md` first.
4. After implementing, take a screenshot of all five modes and confirm the
   neural panel is unchanged.

When asked to implement something not yet shown in the reference: first
sketch a plan in prose, identify which existing tokens / components apply,
and ask before introducing new visual primitives.

<!-- TODO: fill in once decided
## engine / framework

- engine:
- UI framework:
- font loading strategy:
- where SVG sources go:
- where shaders go (for IR/UV/GCaMP color treatments):
-->
