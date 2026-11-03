# GRID CLASH — v6 "Clean Tactical" direction (extends dark-arena.md v5)

Owner direction (2026-11-03), with two reference images:
- **Backgrounds stay dark.** The in-game reference is a dark top-down tactical view: deep navy,
  thin glowing grid and wall lines, a faint hex texture, and vivid blue/red team colours with a
  premium, calm HUD.
- **Arenas will change by score later** ("점수별로 전장"), and each one should feel premium.
  The lobby must have a place to show the current arena from now on.
- **UI must be as intuitive, clean and low-barrier as top casual-competitive mobile games and
  Google apps.** The rules are hard, so the UI must never add friction: big obvious buttons, one
  clear primary action per screen, icons with short labels, minimal reading, instant feedback.
- **3D stays shelved** until it can be done well. Top-down only.

`dark-arena.md` (palette tokens, gold CTA, panel/lip buttons, Black Han Sans display + Pretendard
body) still applies. v6 changes structure and the board treatment; it does not change the palette.

## Principles (take the principles, never another game's assets, logos, fonts or exact layouts)
1. **One primary action per screen**, placed in thumb reach and visually dominant.
2. **Persistent bottom tab bar** on top-level screens. Each tab has a big icon and a 1–2 word
   label, the active tab is raised and highlighted, and the centre tab is Battle. Switching tabs
   never shows a back arrow.
3. **Top bar:** player identity on the left (avatar, name, record/rating) and settings on the
   right. Nothing else.
4. **Show, don't tell.** Prefer icons, diagrams, art and numbers to sentences. Any helper text is
   one short line, and contextual coach marks replace paragraphs.
5. **Chunky, tactile controls.** Buttons have a light top edge, a darker lip and a press-down
   state. Touch targets are at least 48px. Pressed states and haptics are on every tap.
6. **Consistent iconography.** Use one icon set and stroke weight, with team colours used only
   for team meaning.
7. **No dead space.** Every screen uses the full phone height on purpose. No large empty bands.

## Lobby (Battle tab)
- **Centre: the current-arena showcase.** This is a framed card with the arena's art (today the
  single dark arena using `public/bg/match.webp`), its name and a small "다음 전장" teaser slot,
  ready for score-based arenas later. Never invent trophies or numbers the game does not track;
  showing wins, losses and draws is fine.
- **Primary CTA:** a big gold "대전 시작". Difficulty is a compact 3-way segmented control
  directly above it.
- **Hero illustration:** characters can frame the arena card, but must not push the CTA below
  the fold at 360x640.

## In-game
- **Board: "tactical hologram" look.**
  - Deep navy tiles with very low contrast between them.
  - Thin glowing grid lines (cyan at low alpha) and a faint hex or micro-grid texture.
  - Home zones are a soft team-tinted glow with a bright edge line, not saturated solid slabs.
  - The frame is a slim dark bezel with corner brackets (HUD style); thin gold accents are allowed.
  - Move markers stay the v5 glowing dots and rings; they must read clearly on the new tiles.
- **Use the vertical space.** Below the board sits a **"hand" of my 3 piece cards**:
  - each card shows the art, the stars and a mini move diagram;
  - it shows skill readiness for Brutile;
  - a dead piece's card is greyed out.
  - Tapping a card selects that piece, exactly like tapping it on the board.
  - The opponent's lineup stays compact in the top bar.
- **Turn state:** "내 차례" must be unmistakable through the gold turn chip, the timer ring glow
  and a subtle board-edge glow in my team colour.

## Acceptance
- At 360x640, 390x844 and 430x932: no horizontal scroll, the primary CTA is visible without
  scrolling, and no empty band taller than about 8% of the viewport on the game screen.
- Text contrast is at least 4.5:1, touch targets are at least 48px, `prefers-reduced-motion` is
  respected and safe areas are handled.
