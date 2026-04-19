# Umwelt — design tokens

Single source of truth for all UI surfaces. Token names below should be used as
constants in code (do not hardcode hex values in components).

The visual reference lives next to this file at `umwelt_observation.html` —
open it in a browser and click the mode-switcher icons to see each treatment
applied to the same scene + HUD skeleton.

---

## color

### camera scene (per mode)

| token                       | hex / def                         | use                                |
|-----------------------------|-----------------------------------|------------------------------------|
| `scene.visible.bg`          | radial `#5A3A20 → #2E1C0E → #120802` | warm photoreal substrate         |
| `scene.ir.bg`               | radial `#F0C848 → #C85820 → #5E2A6E → #0A1030` | thermographic LUT      |
| `scene.ir.hotspot`          | radial `#FFE080 → #E84B3C` (alpha) | bokeh = hot spots                 |
| `scene.ir.coldbody`         | gradient `#1A3B7A → #050A20`      | cold-body subject (the ant)        |
| `scene.lidar.bg`            | radial `#3E7A98 → #205268 → #0C2A40 → #030A18` | depth-to-color near→far |
| `scene.lidar.wire`          | `#EAF8FF`                         | bright wire edges on subject       |
| `scene.lidar.gridFine`      | `#80B6CE` @ 25% (6px pattern)     | fine wireframe                     |
| `scene.lidar.gridCoarse`    | `#B0DCEE` @ 45% (24px pattern)    | structural wireframe               |
| `scene.uv.bg`               | radial `#1F0A30 → #080310 → #020108` | violet-black UV base            |
| `scene.uv.sugar`            | radial `#EAFBFF → #8FDBFF`        | UV-fluorescent pollen / sugar      |
| `scene.uv.cuticle`          | `#8860D8`                         | faint UV-reactive cuticle stripes  |
| `scene.gcamp.bg`            | radial `#2B312F → #131614 → #060706` | dark gray-green                  |
| `scene.gcamp.ant`           | `#4DE872`                         | GCaMP body (pulses)                |
| `scene.gcamp.antHighlight`  | `#6CF08E`                         | head highlight                     |
| `scene.gcamp.halo`          | radial `#B8FFD0 → #4DE872`        | glow around subject                |

### operator panel + HUD ink

| token                  | hex                          | use                              |
|------------------------|------------------------------|----------------------------------|
| `panel.bg`             | `#141210` @ 90% opacity      | translucent operator workstation |
| `panel.bg.bottom`      | `#0A0806` @ 90% opacity      | gradient bottom stop             |
| `panel.divider`        | `#F5F0E8` @ 15%              | section separators               |
| `ink.primary`          | `#F5F0E8` @ 90%              | headers, primary labels          |
| `ink.body`             | `#F5F0E8` @ 65%              | body text                        |
| `ink.dim`              | `#F5F0E8` @ 55%              | secondary labels                 |
| `ink.faint`            | `#F5F0E8` @ 28%              | tertiary, axes, gridlines        |

### accents

| token                  | hex        | use                                |
|------------------------|------------|------------------------------------|
| `accent.rec`           | `#E84B3C`  | record indicator, danger, warning  |
| `accent.tracking`      | `#E8B878`  | active tracking, edit-mode amber   |

### chemical overlay (false-color on substrate)

| token                  | hex        | use                                |
|------------------------|------------|------------------------------------|
| `chem.food`            | `#8FAE58`  | α food (olive, never neon)         |
| `chem.danger`          | `#E84B3C`  | δ danger                           |
| `chem.beta`            | reserved   | β (define when wired)              |
| `chem.gamma`           | reserved   | γ (define when wired)              |

In `ir` and `gcamp` modes the chemical wash desaturates (saturate ≤ 0.35) so
it doesn't clash with the mode's primary palette.

### neural node families (muted, warm)

| token                  | hex        | node type    | shape              |
|------------------------|------------|--------------|--------------------|
| `node.sensor`          | `#D8B060`  | sensor       | ○ ring + dot       |
| `node.interPos`        | `#8FAE58`  | inter (+)    | △ triangle         |
| `node.interNeg`        | `#C87050`  | inter (−)    | ○ ring             |
| `node.modulator`       | `#A890BC`  | modulator    | ◇ rotated square   |
| `node.motor`           | `#C68A5E`  | motor        | □ square           |

Connection lines take their **source node's** family color. Inactive
connections drop to ~30% opacity; modulatory edges are dashed.

### per-mode UI accent (mode-switcher highlight, mode badge dot)

| mode      | accent     |
|-----------|------------|
| `visible` | `#E8B878`  |
| `ir`      | `#00D4FF`  |
| `lidar`   | `#D06EE8`  |
| `uv`      | `#A078F0`  |
| `gcamp`   | `#4DE872`  |

---

## typography

| family               | use                                                 |
|----------------------|-----------------------------------------------------|
| `Inter` (400, 500)   | UI labels, headers, button text, mode names        |
| `ui-monospace` (`JetBrains Mono` fallback) | all telemetry: timecodes, coords, f-stop, node values, frame counters, distances |

No serifs anywhere.

### scale

| token             | px  | use                                        |
|-------------------|-----|--------------------------------------------|
| `text.xs`         | 9   | axis labels, fine telemetry, sublabels    |
| `text.sm`         | 10  | body labels, callouts, mode badge         |
| `text.md`         | 11  | REC + timecode, subject ID, selected info |
| `text.lg`         | 13  | panel section headers                     |

### casing rules — strict

- sentence case or **lowercase only** — no Title Case anywhere
- never ALL CAPS, especially never with letter-spacing
- units stay lowercase (`mm`, `m`, `s`, `fps`, `iso`, `rh`)
- biological taxa keep botanical formatting (`Formica cf. japonica`, italics
  optional)
- chemical overlay channels lowercase greek (`α β γ δ`)

---

## stroke & line

| token              | value         | use                            |
|--------------------|---------------|--------------------------------|
| `stroke.hairline`  | 0.3 px        | guide rails, gridlines         |
| `stroke.fine`      | 0.5 px        | dividers, chip outlines        |
| `stroke.line`      | 0.8–1 px      | reticle corners, leader lines  |
| `stroke.bold`      | 1.2–1.5 px    | active connection, node outline|

**Hard rule:** no HUD stroke exceeds 1.5 px. No thick borders, ever.

---

## layout

The 1280 × 720 frame splits 760 / 520:

```
┌────────────── camera (760) ──────────────┬── operator panel (520) ──┐
│                                          │                          │
│  REC / mode switcher (top-left)          │  subject CNS · live      │
│  subject tag (top-right)                 │  legend                  │
│                                          │                          │
│              [ tracking reticle          │  ┌── selected ──┐        │
│                 around subject ]         │                          │
│                                          │  ○──────△──────○──□      │
│                                          │       │              │   │
│                                          │  ◇────┘              □   │
│  scale bar / coords / chem chips /       │                          │
│  playback / frame counter (bottom)       │  live trace              │
│                                          │  edit circuit →          │
└──────────────────────────────────────────┴──────────────────────────┘
```

| token                | value     | use                              |
|----------------------|-----------|----------------------------------|
| `frame.width`        | 1280 px   | full artboard                    |
| `frame.height`       | 720 px    | full artboard                    |
| `cam.width`          | 760 px    | camera viewport                  |
| `panel.width`        | 520 px    | operator workstation             |
| `inset`              | 30 px     | HUD margin from corner           |
| `panel.inset`        | 24 px     | inside panel left/right padding  |
| `node.row.h`         | 60 px     | vertical step between node rows  |
| `node.col`           | 110 px    | horizontal column step           |

---

## components

Each component below maps to a class name in `umwelt_observation.html`. Match
these names in code so the HTML reference stays a 1:1 spec.

| class                  | purpose                                              |
|------------------------|------------------------------------------------------|
| `.artboard`            | one full 1280×720 frame, owns `data-mode`           |
| `.scene`               | base camera-feed layer (one of 5 per artboard)      |
| `.scene-{mode}`        | mode-specific rendering (visible / ir / lidar / uv / gcamp) |
| `.mode-switcher`       | top-left segmented control                          |
| `.mode-btn`            | one button in the switcher                          |
| `.mode-btn.active`     | active state — uses per-mode accent                 |
| `.mode-badge`          | label + dot under the switcher, names current mode  |
| `.reticle`             | corner brackets framing the subject                 |
| `.chem-overlay`        | grouped chemical washes; desaturates in IR/GCaMP   |
| `.chem-callouts`       | leader lines + distance labels for chem centers     |
| `.neural-panel`        | full right-side panel (CNS workstation)             |
| `.gcamp-ant-pulse`     | applied to GCaMP ant body — 2.4 s ease pulse       |
| `.gcamp-ant-glow`      | applied to GCaMP halo — 2.4 s ease pulse           |

---

## modes — at a glance

| mode      | scene treatment                                           | mode badge | chem overlay |
|-----------|-----------------------------------------------------------|------------|---------------|
| `visible` | photoreal macro, warm browns, shallow DOF bokeh           | amber      | full color    |
| `ir`      | thermographic LUT, cold-body subject, hot bokeh           | cyan       | desaturated   |
| `lidar`   | depth-to-color, wireframe overlay, polygonal subject      | magenta    | dashed outline|
| `uv`      | violet-black, UV-reactive sugar glows, ant nearly invisible | violet   | sugar-only    |
| `gcamp`   | dark gray-green, subject glows bright green and pulses    | green      | desaturated   |

Subject always stays centered. UI never obscures the ant. Neural-panel
topology is identical across all 5 modes — same CNS being observed.

---

## hard constraints

1. No sci-fi neon. No CRT scanlines. No datamosh.
2. No ALL CAPS with letter-spacing.
3. HUD line weight stays 0.5–1 px (1.5 px max for emphasis only).
4. Subject is always visible and centered.
5. Photoreal renders never get UI styling applied to them — only thin data
   overlays on top.
6. Chemical wash colors stay desaturated in IR + GCaMP.
7. Neural panel layout, node positions, and connection topology are identical
   across all 5 modes.
