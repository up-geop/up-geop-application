---
name: UP GEOP Applicant Portal
description: The Geodetic Wayfarer — Field survey notebook meets Philippine transit craft
colors:
  primary: "#C1272D"
  primary-hover: "#A02025"
  secondary: "#FBB03B"
  secondary-subtle: "#FFF7EB"
  neutral-dark: "#2B2B2B"
  neutral-black: "#111111"
  neutral-bg: "#F4F1EB"
  surface: "#FFFFFF"
  surface-subtle: "#EBE5DA"
  border-subtle: "#DCD4C5"
  border-medium: "#C4B9A3"
  text-heading: "#111111"
  text-body: "#333333"
  text-muted: "#666666"
typography:
  display:
    fontFamily: "'Fraunces', serif"
    fontSize: "1.8rem"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "'Fraunces', serif"
    fontSize: "1.4rem"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "'Figtree', sans-serif"
    fontSize: "1.1rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "'Figtree', sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Figtree', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    letterSpacing: "0.05em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "20px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text-heading}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "20px"
  badge:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text-heading}"
    rounded: "{rounded.lg}"
    padding: "4px 10px"
---

# Design System: UP GEOP Applicant Portal

## Overview

**Creative North Star: "The Geodetic Wayfarer"**

The UP GEOP Applicant Portal marries the meticulous record-keeping of a geodetic surveyor's field notebook with the communal, vibrant energy of Filipino commuter culture (*Biyahe* — *"Kasya pa, sakay na!"*). Rather than treating applicant evaluation as an intimidating corporate pipeline, the system visualizes progress as a shared transit route and an unfolding survey control network. High-contrast route signage, enamel badges, and tactile field cards make milestones feel physical, durable, and celebratory.

The aesthetic avoids the cold, clinical minimalism of modern enterprise SaaS while remaining disciplined enough for rapid validation and grading. Warm Manila parchment surfaces soften dense data grids, while authoritative Jeepney Crimson and Star Gold accents direct attention to active waypoints, immediate calls to action, and real-time verification alerts.

**Key Characteristics:**
- **Tactile Paper Surfaces:** Grounded on warm Manila paper (`#F4F1EB`) and crisp white card containers framed by earthy tactile borders.
- **Enamel Transit Signage:** High-contrast badge tokens, clear route tabs, and bold status indicators inspired by Philippine jeepney placards.
- **Geodetic Precision:** Clean tabular data, node-link survey networks, and clear numeric milestones paired with human-readable guidance.
- **Outdoor Legibility:** High-contrast typographic scales and dark-mode alternatives built for outdoor campus glare and late-night study sessions.

## Colors

The palette pairs high-contrast transit signals with warm, earthy parchment neutrals.

### Primary
- **Jeepney Crimson** (`#C1272D` / hover `#A02025`): The primary actionable signal across the application. Used for primary interactive triggers (check-in buttons, active navigation tabs, urgent toasts, and overall grade highlights).

### Secondary
- **Star Gold** (`#FBB03B` / subtle `#FFF7EB`): The secondary highlight tone. Employed for active focus rings, celebration alerts, multiplier boosts, and secondary tag borders.

### Neutral
- **Manila Parchment** (`#F4F1EB`): The primary page canvas background, evoking field notebooks and campus documentation.
- **Surface White** (`#FFFFFF` in light mode, `#1E1E1E` in dark mode): Card and container backgrounds providing crisp legibility.
- **Surface Subtle** (`#EBE5DA` in light mode, `#2A2A2A` in dark mode): Table headers, inactive button backgrounds, and pill badges.
- **Border Subtle** (`#DCD4C5`): Delimits standard card sections and table rows without distracting visual weight.
- **Border Medium** (`#C4B9A3`): Outlines inputs, secondary buttons, and badge frames.
- **Charcoal Heading** (`#111111`): High-contrast serif headings for immediate reading.
- **Body Neutral** (`#333333`): Standard body copy for instructions and labels.
- **Muted Text** (`#666666`): Secondary metadata, timestamps, and subtext.

### Named Rules
**The Signpost Rule.** Crimson (`#C1272D`) is reserved exclusively for active waypoints and primary actions (active navigation tabs, check-in buttons, crucial status badges). It must never coat passive background cards or large structural containers.

## Typography

**Display Font:** Fraunces (serif)  
**Body Font:** Figtree (sans-serif)  
**Label/Mono Font:** Monospace (system monospace stack)

**Character:** The pairing of Fraunces' warm, chiseled serif numerals with Figtree's geometric, approachable sans-serif gives the portal an unmistakable balance of academic tradition, collegiate warmth, and transit-sign clarity.

### Hierarchy
- **Display** (Fraunces, Bold 700, 1.8rem–2.2rem, line-height 1.2): Hero portal title, large milestone figures, and timer readouts.
- **Headline** (Fraunces, Semi-bold 600, 1.3rem–1.5rem, line-height 1.3): Card section headers and modal titles.
- **Title** (Figtree, Semi-bold 600, 1.05rem–1.15rem, line-height 1.4): Sub-section titles, table column groups, and task item headings.
- **Body** (Figtree, Regular 400, 0.9rem–0.95rem, line-height 1.5): Descriptive text, instructions, and list item copy.
- **Label** (Figtree, Bold 700, 0.75rem–0.85rem, uppercase, letter-spacing 0.5px): Stat box categories, badge labels, and table headers.
- **Code / Token** (Monospace, Bold 700, 1.4rem–1.8rem, letter-spacing 2px–4px): Alphanumeric 6-character validation codes and verification shortcodes.

## Layout

- **Container Model:** Centralized single-column flow constrained to a maximum width of 900px, centering primary tasks on desktop and expanding naturally to full-width edge-to-edge padding (16px) on mobile viewports.
- **Spatial Rhythm:** Built on an 8px base grid (`8px`, `12px`, `16px`, `20px`, `24px`, `32px`). Card gaps and grid items default to `12px`–`16px` spacing.
- **Mobile-First Tab Navigation:** Horizontally scrolling pill navigation (`.tab-nav`) allowing quick thumb switching across all functional views without wrapping or crowding.
- **Adaptive Grids:** Stats overview and buddy groups use auto-fitting responsive grids (`repeat(auto-fit, minmax(140px, 1fr))`) ensuring dense, balanced statistics across phones and laptops.

## Elevation & Depth

The system adheres to a **Paper & Enamel Signage** depth philosophy. Surfaces are flat at rest, relying on 1px solid structural borders (`--border-subtle` and `--border-medium`) rather than heavy ambient blurs to convey form and hierarchy.

### Shadow Vocabulary
- **Card Rest** (`box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03)`): Ambient grounding for resting cards against Manila parchment.
- **Modal Elevation** (`box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15)`): Focused elevation separating modals and dialog overlays from the backdrop.
- **Toast Float** (`box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15)`): Interactive feedback banners floating above bottom viewports.

### Named Rules
**The Border-Before-Blur Rule.** Depth and section separation must be achieved through border contrast and subtle tonal shifts (`--surface` vs `--surface-subtle`) rather than heavy multi-layered drop shadows.

## Shapes

- **Corner Language:** Rounded geometry reflects friendly, tactile signage.
  - `--radius-sm` (`8px`): Buttons, inputs, tab pills, and task list items.
  - `--radius-md` (`12px`): Primary cards, stat containers, and modal dialogs.
  - `--radius-lg` (`20px`): Status badges, pill tags, and search filter pills.
- **Borders:** Consistent `1px solid` frames on all interactive and container elements. Inputs switch to a bold `2px solid` Star Gold (`#FBB03B`) focus ring with Crimson border shift on interaction.

## Components

### Buttons
- **Shape:** Rounded corners (`8px`).
- **Primary (`.btn-checkin`):** Bold Jeepney Crimson (`#C1272D`) background with white text, padding `8px 16px`, min-height 40px for mobile touch targets. Hover state transitions to Deep Crimson (`#A02025`).
- **Secondary (`.btn-secondary`):** Manila subtle background (`#EBE5DA`), Charcoal heading text, outlined with 1px solid `--border-medium`.

### Badges & Status Pills
- **Style:** Compact pill badge (`border-radius: 20px`), padding `4px 10px`, font size `0.75rem`, bold 600 weight.
- **Variants:** Neutral subtle for standard metadata; Solid Crimson for active milestones and officer badges; Star Gold subtle for session boosts.

### Cards / Containers
- **Style:** Solid white background (`#FFFFFF`), `12px` border-radius, bordered by `1px solid var(--border-subtle)`.
- **Card Header:** Flex container separating section title/subtext from action badges.

### Form Inputs & Textareas
- **Style:** Clean white background, `1px solid var(--border-medium)`, `8px` border radius, padding `8px 12px`.
- **Focus:** 2px outline in Star Gold (`#FBB03B`) with crimson border shift.

### Navigation Tabs
- **Style:** Pill button row (`.tab-btn`), background `var(--surface-subtle)` with medium border. Active tab flips to solid Crimson (`#C1272D`) with white typography.

### Survey Control Network (Signature Component)
- **Container:** High-contrast framed canvas card (`border: 2px solid var(--brand-forest)`) housing the interactive Vis.js geodetic node network.
- **Nodes & Edges:** Visualizes applicants as roving stations and verified resident members as fixed benchmark control points.

## Do's and Don'ts

### Do:
- **Do** preserve the warm Manila paper canvas (`#F4F1EB`) as the primary background for all public views.
- **Do** maintain a minimum touch target size of 44×44px for primary mobile interaction buttons (check-in, code copy, tab switches).
- **Do** use Fraunces serif font for major headings, progress percentages, and numeric counters.
- **Do** provide alphanumeric text fallbacks alongside all visual network graphs and QR codes.

### Don't:
- **Don't** introduce cold blue-gray tech gradients, glassmorphism, or sterile generic corporate SaaS styles.
- **Don't** use Jeepney Crimson for decorative background fills or inactive list rows; preserve it for active waypoints and actions.
- **Don't** hide verification progress behind ambiguous icons; always pair visual icons with explicit numeric progress (e.g. `12 / 21`).
- **Don't** use unreadable novelty or handwriting display fonts that compromise rapid mobile validation in outdoor sunlight.
