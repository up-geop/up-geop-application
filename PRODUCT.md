# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Applicants:** University of the Philippines students undergoing the UP GEOP recruitment process. Accessing primarily on mobile devices during campus hours to view their overall grade, track required signatory interviews, log tambay hours, attend events, monitor buddy tasks, and check the signatory network graph.
- **Resident Members:** Active members conducting signatory interviews, mentoring buddy groups, and verifying applicant check-ins and tasks via 6-character validation codes.
- **RAComm (Recruitment and Admissions Committee) Officers:** Administrative committee members using desktop and mobile to manage applicant rosters, organize buddy groups, publish tasks, configure global policies (tambay multipliers, caps, signatory limits), adjust event schedules, and export records.

## Product Purpose

The UP GEOP Applicant Portal digitalizes and gamifies the organizational recruitment process. It replaces error-prone physical signatory sheets, manual tambay logbooks, and dispersed spreadsheets with a unified, transparent, and engaging web platform that guides applicants toward full membership while streamlining administrative operations for officers.

## Positioning

A dedicated organizational portal tailored specifically to the Geodetic Engineering community at UP. It uniquely fuses Filipino commuter culture ("Biyahe" — *"Kasya pa, sakay na!"*) with geodetic domain concepts, turning abstract recruitment requirements into an interactive "Survey Control Network" where applicants and resident members form benchmarks, nodes, and baselines.

## Operating Context

- Mobile web and PWA usage during campus hours (tambayan sessions at Melchor Hall, campus walks, bonding events, Sunken Garden gatherings).
- Variable campus cellular data connections requiring lightweight assets, responsive layouts, and clear offline/loading states.
- High-efficiency desktop usage for RAComm administrators reviewing bulk applicant rosters, tracking deadlines, and exporting grading data.

## Capabilities and Constraints

- **Authentication:** Single Sign-On via Google OAuth restricted to verified `@up.edu.ph` institutional accounts.
- **Weighted Grading Model:** Transparent calculation engine tracking 7 core components:
  - Official Events (25%)
  - Signatory Interviews (15%)
  - Interview (15%)
  - On-the-Ground Training / OGT (20%)
  - Constitution Quiz (10%)
  - Buddy Tasks (10%)
  - Tambay Hours (5% with target 24 hours, daily caps, and multiplier controls)
- **Verification Engine:** Time-based 6-character code generation and QR code display for quick, tamper-resistant time-in/out logging and signatory signatures.
- **Gamification & Perks Shop:** AppCoins (AC) virtual currency awarded for milestones; individual boosts (e.g. 1.5x Tambay Multiplier); communal crowdfunded pots allowing applicant groups to pool AC to extend task deadlines (+2 days).
- **Survey Control Network Visualization:** Interactive node-link graph (powered by Vis.js) mapping verified resident connections as geodetic survey nodes.
- **Technical Architecture:** Client-rendered vanilla HTML5/CSS3/ES modules with Supabase backend (`@supabase/supabase-js`), Vis.js Network, and Web App Manifest (`manifest.json`).

## Brand Commitments

- **Official Names:** UP GEOP Applicant Portal / GEOP Portal.
- **Theme & Tagline:** *Biyahe* ("Kasya pa, sakay na!") — expressing communal journey, inclusivity, and shared destination.
- **Visual Identity:** Geodetic survey motifs (benchmarks, triangulation, control networks) coupled with jeepney commuter graphics and warm campus tones.
- **Color Anchors:** Deep Forest Green (`#1B382B`), Cream / Parchment (`#FAF5EA` / `#F4F1EB`), Accent Mint, and Jeepney Red / UP Crimson (`#C1272D`).
- **Typography:** Fraunces (display serif for headings) and Figtree (clean geometric sans-serif for body).
- **Voice & Tone:** Encouraging, warm, collegiate, transparent, and proud of geodetic engineering discipline.

## Evidence on Hand

- `AO BIYAHE LOGO.png`, `geop.png`, `logo.png.jpg` in repository root.
- Working prototype with complete modular scripts under `js/` (`app.js`, `storage.js`, `signatories.js`, `auth.js`, `events.js`, `admin.js`, `config.js`, `tambay.js`).
- Google Sheets data pool endpoints configured for applicant traits and dynamic tasks.
- Responsive styles in `styles.css` with active light and dark theme variable tokens.

## Product Principles

1. **Balanced Experience:** Treat applicant transparency and officer administrative ergonomics with equal priority; both journeys must remain intuitive, fast, and delightful.
2. **Authentic Domain Storytelling:** Ground progress visualization in genuine Geodetic Engineering principles (survey networks, control points) and Filipino transport culture ("Biyahe").
3. **Clarity Over Obscurity:** Provide explicit criteria, instant feedback on task progress, and unambiguous status for every requirement.
4. **Collaboration Over Rivalry:** Use gamification (buddy task crowdfunding, shared group milestones) to foster camaraderie rather than toxic competition.

## Accessibility & Inclusion

- High-contrast visual presentation with clear differentiation for outdoor daylight conditions and low-light night study sessions.
- Generous mobile touch targets (minimum 44×44px) across verification buttons, inputs, and tab navigation.
- Dual-mode verification: alphanumeric fallback codes provided alongside visual QR codes and network graphs.
