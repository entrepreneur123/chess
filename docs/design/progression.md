# GRID CLASH — progression: currencies, rating, arenas, modes (owner spec, 2026-11-03)

The owner's spec, made binding. All numbers live in `src/meta/progression.ts`; do not duplicate
them elsewhere. Any number not given by the owner is marked **(lead default)** and listed again in
"Decisions to confirm" at the end.

## Currencies
- **No gold, no boxes, no other currency.**
- **토큰 (token):** a shaded hexagonal token. Spent on star upgrades. Earned only from the daily
  dungeon reward.
- **에센셜 (essence):** spent in the essence shop to unlock characters. Earned from 전장전 and
  견습전투: win 3, draw 1, loss 0. No daily cap.

## Star upgrades (tokens)
| Rarity | 1성 → 2성 | 2성 → 3성 |
| --- | --- | --- |
| 일반 (common) | 5 | 50 |
| 희귀 (rare) | 10 | 100 |
| 영웅 (epic) | 20 | 150 |
| 전설 (legendary) | 50 | 300 |

- A newly unlocked character starts at 1성.
- The player may still field a lower grade than they own: the grade picker shows grades up to the
  owned level, and higher grades are locked with their upgrade cost. **(lead default:** each grade
  has a different move pattern, so choosing a lower one stays a tactical option.)

## Daily dungeon (tokens)
- The dungeon is a bot battle. Difficulties and rewards: 쉬움 5, 보통 10, 어려움 15, 극악 20 tokens.
- **Only one reward per day.** Only a win claims it. A loss or draw gives nothing and leaves today's
  chance open.
- After the reward is claimed, the dungeon can still be played for practice with no reward.
  **(lead default)**
- The day resets at local midnight on the device. **(lead default)**
- The dungeon does not change rating and gives no essence. **(lead default)**
- 극악 is a new bot strength above 어려움. The owner will tune dungeon difficulty later, so keep
  every difficulty knob in one table.

## Rating and arenas
| # | Arena | Rating | Win + | Loss − | Characters it opens in the shop |
| --- | --- | --- | --- | --- | --- |
| 1 | 달빛 룬 투기장 (moonrune) | 0–300 | 29–31 | 5–7 | 사드, 마르키, 월크 (owned from the start) |
| 2 | 잿불 대장간 (emberforge) | 301–600 | 25–29 | 10–14 | 브루타일 |
| 3 | 독초 늪 신전 (blightmire) | 601–1000 | 20–22 | 15–17 | 인세이너 |
| 4 | 서리 성채 (frostkeep) | 1001–1500 | 18–22 | 17–20 | 미셸 (Michelle) |
| 5 | 광기의 왕좌 (madcrown) | 1501–2000 | 15–17 | 19–21 | 피커 (Picker) |
| 6 | 천공의 정점 · 전설 (apex) | 2001+ | 14–16 | 20–22 | 라카엘리 (Rakaeli) |

- **Gain and loss.** The amount is a random integer in the range of the arena the player was in
  when the match started.
- **Draw:** rating unchanged. **(lead default)**
- **Floor and demotion.** Rating never goes below 0. Demotion is automatic, because the arena
  always follows the rating; a player at 601 who loses down to 590 is back in arena 2.
- **Boundary.** The owner wrote "1501–2000" and "2000 이상 전설". 2000 stays in arena 5 and the
  legend arena starts at 2001. **(lead default)**
- **Which character opens where.** 브루타일 is in arena 2 and 인세이너 in arena 3. **(lead
  default:** both are legendary; 인세이너's absorb passive is the stronger one, so it comes later.)

## Essence shop
- It sells characters that are opened in the player's **current** arena or any lower one and are
  not owned yet.
- Prices: 일반 30, 희귀 50, 영웅 100, 전설 200 essence. A bought character arrives at 1성.
- After a demotion, characters from higher arenas show as locked with "N 전장 도달 시 구매 가능".
  Characters already owned stay owned.

## Modes
1. **전장전 (ranked).**
   - The opponent is in the same arena with a rating close to the player's (about ±60, clamped to
     the arena's range).
   - Changes rating and gives essence.
2. **견습전투 (casual).**
   - The opponent comes from a wider random band around the player's rating (about ±150), so
     specs stay similar.
   - No rating change; gives essence.
3. **던전 (dungeon).** Pick 쉬움 / 보통 / 어려움 / 극악; the daily token reward rules above apply.

### Opponents
There is **no online backend yet**, so every opponent is an AI and is labelled "AI" honestly,
never presented as a human. Matchmaking still simulates a rating band, so the same interface can
later be served by a real server.

- **Arena pool.** In 전장전 and 견습전투 the AI squad is drawn only from characters opened up to
  the opponent's arena.
- **Grades.** The AI's grades track the player's own fielded grades: average ± 1, clamped to 1–3,
  so the specs never diverge much.
- **Strength by arena.**

  | Arena | AI strength |
  | --- | --- |
  | 1 | easy |
  | 2–3 | normal |
  | 4–5 | hard |
  | 6 | extreme |

  **(lead default; tunable.)**
- **Dungeon** uses fixed squads per difficulty: the existing easy, normal and hard tiers, and 극악 =
  three 3성 including at least one legendary at extreme strength.

## Profile (schema v5; v4 plus the 10 x 10 board migration)
| Field | Meaning |
| --- | --- |
| `owned: Record<CharacterId, 0\|1\|2\|3>` | 0 = locked; otherwise the highest star owned. |
| `grades` | Fielded grade per character, always ≤ owned. |
| `tokens`, `essence` | Non-negative integers. |
| `rating` | Rating. |
| `bestRating` | Highest rating reached, for display. |
| `dungeon.lastClaimDay: string \| null` | Day key of the last claimed dungeon reward. |
| `dungeonLevel` | Last chosen dungeon difficulty. |
| `settings.music: boolean` | Background music on or off. |
| `stats` | Wins, losses and draws over ranked + casual. |

- **Migration v3 → v4** (pre-release, so it is a reset): own the 3 starters at 1성, set all grades
  to 1, and set tokens, essence and rating to 0. The formation keeps its positions only if every
  piece is owned; otherwise it falls back to the default.
- **Migration v4 → v5** (the board went from 12 x 12 with a 3 x 12 home zone to 10 x 10 with a
  2 x 10 zone): every field is kept, except a saved formation with any piece outside the new zone
  (local row > 1 or column > 9). It is reset to the preset squares for the same squad (the
  starters if that squad is not owned) and marked unsaved (`formationSaved: false`).
- **Validation.** A formation may contain only owned characters, at grades ≤ owned.
- **Security note.** All of this lives in localStorage and can be edited by the user. Real PvP,
  leaderboards or purchases need server-side authority first.

## UI (v6 Clean Tactical rules apply)
- **Top bar on tab screens:** rating with the arena badge, tokens (hex icon) and essence (icon).
  Tapping a currency explains where it comes from.
- **Tabs:** 상점 · 캐릭터 · 대전 (centre) · 진형 · 전장.
- **Lobby:**
  - Arena card: the current arena art, name, rating and a progress bar to the next arena.
  - Primary CTA: 전장전.
  - Secondary row: 견습전투, and 던전 with a "오늘 보상 가능 / 받음" badge.
- **전장 (arena road):** all 6 arenas with their rating ranges, the characters each one opens, and
  the player's position.
- **Character screen:**
  - owned or locked state;
  - the upgrade button with its token cost, disabled with the shortfall shown when tokens are
    short;
  - the grade picker limited to owned grades;
  - for a locked character: its arena and price.
- **Shop:** buyable characters with prices, plus locked ones with the arena needed.
- **Result screen:**
  - rating delta (e.g. +30) and the new rating with the arena bar;
  - essence gained;
  - dungeon tokens, or "오늘 보상은 이미 받았어요";
  - a promotion or demotion banner;
  - "상점에 새 캐릭터" when a promotion opens one.
- **Theming:** the match backdrop and the lobby card follow the current arena (art from
  `public/arenas/<id>/`).

## Arena themes and music
Each arena has a card art, an in-match backdrop and a BGM loop. All are original; the Dark Arena
palette and readability rules apply, and the centre of the backdrop stays calm because the board
sits there.

**Music rule:** every arena has its own battle track, and the lobby has its own home theme that is
no arena's track. The lobby and every tab screen (shop, collection, formation, arenas) play the
lobby theme. A match plays its arena's track from the matchmaking VS card through the result panel;
the search phase before the VS card keeps whatever was playing (no 1–2 s detour through the lobby
theme on a rematch). Leaving the result panel crossfades back to the lobby theme. Scores, numbers
and a distinctness audit: `docs/brand/audio/bgm/README.md`.

| Arena | Visual concept | Music concept |
| --- | --- | --- |
| moonrune | cold moonlight, rune circles, mist, iron gate | low strings, harp, soft taiko; tense but calm; about 84 BPM |
| emberforge | volcanic forge, molten channels, anvils, embers | anvil percussion, low brass, driving drums; about 100 BPM |
| blightmire | toxic swamp shrine, green fog, roots, witch lanterns | plucked strings, eerie choir hum, hand drums; about 90 BPM |
| frostkeep | ice citadel, aurora, frozen banners | glass bells, wide pads, war drums; about 96 BPM |
| madcrown | violet-crimson throne hall, broken chains, demon fire | organ, dark choir, a triplet (12/8) drum pulse; about 110 BPM |
| apex | floating arena above clouds, gold and starlight | full epic orchestral, triumphant but tense; about 120 BPM |
| *(lobby, home)* | the lobby and tab screens; no backdrop of its own | warm, festive "home base": Eb major (the only major-key track), drum-kit backbeat with claps, bass guitar, marimba, brass fanfare, the Clash leitmotif in a major variant; about 104 BPM |

**Music module contract** (`src/audio/music.ts`):
- `setMusicTrack(id: string | null)` crossfades to `public/audio/bgm/<id>.m4a` (an arena's `bgm`
  or `lobby`), loops seamlessly, and does nothing if that track is already playing.
- `setMusicEnabled(on: boolean)` switches music on or off.
- `duckMusic(on: boolean)` lowers the music under voice lines and cut-ins.
- It respects `settings.sound && settings.music`, autoplay policies (start after the first user
  gesture) and page visibility (pause when hidden).

## Decisions to confirm with the owner (lead defaults in use)
1. Rating on a draw: no change.
2. Rating 2000 is arena 5; the legend arena starts at 2001.
3. Brutile opens in arena 2 and Insaner in arena 3; Michelle opens in arena 4 and Picker in arena 5
   (docs/design/new-characters-michelle-picker.md); Rakaeli opens in arena 6 for 100 essence
   (docs/design/new-character-rakaeli.md).
4. Players can field a lower grade than they own.
5. The dungeon is playable after the daily claim (no reward), gives no essence and no rating, and
   resets at device midnight.
6. AI strength by arena, and the ranked/casual rating bands (±60 / ±150).
7. All opponents are AI until an online backend exists.
