# Hyperframes Composition Brief: Sophos

## Objective
Create a short launch-style brag video for Sophos.

## Output
- Composition directory: `/home/cayleb/Work/projects/oss-showcase/sophos/brag-output/composition/`
- Rendered video: `/home/cayleb/Work/projects/oss-showcase/sophos/brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 20.2 seconds (0 → 20.19)

## Source Material
- Project root: /home/cayleb/Work/projects/oss-showcase/sophos
- Primary files read: README.md, index.html, src/design/global.css, src/views + src/shell
- Product name: Sophos
- Tagline / strongest claim: A Windows-native coding agent. Own your intelligence.
- Key UI or visual moment to recreate: the app's real views — Chat, Sessions graph, Agents fleet, Skills panel — as sharp dark cards
- Copy that must appear verbatim:
  - Own your intelligence.
  - 1,118 tests passing
  - upstream credit: PrimeIntellect-ai/prime-agent

## Creative Direction
- Tone preset: polished
- Creative direction: clean product film for a Windows developer audience
- Interpretation: 4 scenes, long holds, clean slides; confidence through restraint; warm near-black surfaces, sharp corners, terminal-green accents
- Angle: The port is the product — real app views arrive like native windows, then the receipts land with upstream credit given by name.
- Hook: "Own your intelligence." over "SOPHOS · WINDOWS-NATIVE" + port sub-line
- Outro / punchline: "Sophos — Own your intelligence." + "Windows 10/11 · signed installer · MIT-licensed."
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign

## Visual Identity
- Background: #1a1a18 (exact, --pa-ink)
- Card: #232320 (--pa-card)
- Text: #ece9e2 (exact, --pa-paper)
- Accent: #82b89b (terminal green, --pa-green)
- Hairline: #3f3d38 (--pa-border)
- Muted paper-0.64: use only at ≥31px (contrast caution on near-black)
- Corners: sharp, 4px radius
- Display font: system-ui grotesque stack (app uses Geist, not available to renderer)
- Body font: same stack; data/mono lines: ui-monospace/Consolas
- Visual references from the project: Chat view, Sessions graph, Agents fleet, Skills panel (assets/*.png), Tauri shell + Node bridge architecture

## Storyboard
Use the storyboard in `/home/cayleb/Work/projects/oss-showcase/sophos/brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Hook: the tagline — 3.27s — giant "Own your intelligence." + port sub + platform strip
2. The real views — 5.47s — CHAT / SESSIONS GRAPH / AGENTS FLEET / SKILLS cards arrive one by one
3. Receipts payoff — 7.10s — "1,118 tests passing" + upstream credit + installer lines
4. Outro: the name — 4.35s — Sophos + tagline + Windows/MIT lines

## Audio
- Audio role: restrained professional bed with sparse accents
- Audio arc: quiet bed establishes under hook, momentum under view cards, single bell at 1,118 payoff, soft bell + fade at outro
- Music: music-bed.mp3 (copied vol-12 into composition/assets/music/), volume 0.30, fade last ~1.5s
- Music cue guidance: bundled preset /home/cayleb/.skill-library/active/brag/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json — strong locks at 8.74 / 13.11 / 15.84 (±0.15s); beat-grid card arrivals at 4.39/4.91/5.34/6.00 and receipt lines at 13.64/14.20 (±0.10s); ignore cues wherever they hurt readability
- Audio-reactive treatment: subtle; terminal-green accent glow + card presence breathe gently with the bed (authored pulse acceptable if RMS extraction helper unavailable — document it)
- Audio-coupled moments:
  - Scene 2 view cards — one soft drop as first card lands, rest silent on beats
  - Scene 3 1,118 payoff — one short bell at 13.11
  - Scene 4 outro title — one soft bell at ~15.9
- SFX selection guidance: low-HF-risk only; soft sounds for card reveals, short announcement cue for the 1,118 payoff, restraint when the edit is busy
- SFX analysis guidance: /home/cayleb/.skill-library/active/brag/assets/sfx/sfx-analysis.md
- Exact SFX choice: Hyperframes should choose filenames, timestamps, density, and volume based on the implemented animation (suggested: interface/drop_001, impact/impactBell_heavy_000, impact/impactBell_heavy_003 — already copied into composition/assets/sfx/)
- Audio files: copied into `/home/cayleb/Work/projects/oss-showcase/sophos/brag-output/composition/assets/`

## Hyperframes Instructions
Load the composition-building Hyperframes domain skills — `hyperframes-core` (composition contract + `data-*` timing), `hyperframes-animation` (motion), `hyperframes-creative` (design spec, beats, audio-reactive), `hyperframes-keyframes` (seek-safe keyframes), and `hyperframes-cli` (lint/check/render). /brag is its own workflow: do not enter the `hyperframes` entry-point intent interview and do not route into its generic promo / launch-video workflow. Prefer native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show at least one real UI, copy, or visual element from the source project.
- Keep all text readable in the final render.
- Keep the video within 15-25 seconds.
- Include the planned music/SFX layer unless audio was explicitly disabled or documented as intentionally silent.
- Treat `/brag` audio notes as guidance, not a fixed cue sheet. Choose SFX after the visual animation exists.
- Treat music cue metadata as optional timing hints. Hyperframes decides exact animation timing and should ignore cues that hurt readability, scene pacing, or the product story.
- Major reveals may move toward nearby strong cues within about 0.15s. Smaller entrances may align to nearby beat points within about 0.10s. Use only 1-3 strong cue locks in a 15-25s video unless the edit clearly benefits from more.
- Use SFX to support motion and interaction: card sounds for card-like reveals, short announcement cues for major payoffs, key/click sounds for text or user actions, and restraint when the edit is already busy.
- Honor planned music treatment such as fade-outs, ducking, beat-aligned reveals, or letting a final SFX ring over the music, using the best Hyperframes-supported implementation.
- When music is present and the treatment is not `none`, consider Hyperframes audio-reactive workflow: extract audio data and use RMS/frequency bands for subtle, brand-specific motion. Good targets are glow, depth, background warmth, card presence, title emphasis, or other existing visual elements. Avoid waveform/equalizer visuals, musical-note graphics, generic particle systems, strobing, or heavy pulsing.
- Use local assets for audio and any required runtime/media dependencies when possible.
- Run `hyperframes check` before render — it is brag's single gate.
