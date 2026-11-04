# New characters: 미셸 (Michelle) and 피커 (Picker) — owner spec, 2026-11-04

This spec is binding. Items marked **(lead default)** are decisions the owner did not state; they
are listed again at the end for confirmation.

## 미셸 · Michelle (`michelle`) · 일반 (common)

**Look**
- A gloomy little girl. Her long bangs cover her eyes and she always holds a doll.
- Mood reference: a little like Wednesday, or young Jinx from Arcane. Take the mood only; never
  copy those characters' designs, hairstyles, costumes or colour schemes.

**Voice**
- The gloomy, quiet voice of a little girl.

**Movement** ("back" is toward her own side and follows the piece's direction, like every other
character)
| Grade | Moves |
| --- | --- |
| 1성 | left, right or back, 1 square |
| 2성 | left, right or back, up to 2 squares in a straight line, plus forward 1 square |
| 3성 | left, right or back, up to 2 squares, plus forward up to 2 squares (a straight slide) |

(Owner change, 2026-11-04: the forward step moved from 3성 down to 2성, and 3성 now slides
forward up to 2. Doll traps still come from backward moves only.)

- Moves slide like 사드's: the path must be clear, and she captures the enemy on the landing
  square.
- **Turning around (owner rule, 2026-11-04).** Like every forward mover, she turns around when she
  reaches the far edge in her forward direction (the enemy's back rank). Her forward and back
  swap, so after the turn her "back" (where her doll traps come from) points toward the enemy
  side. Whether a move is backward is judged with her direction before that move.

**Trait: 인형 함정 (doll trap)**
- **When a trap is laid.** The first **3** times in a match that Michelle makes a **backward**
  move, she leaves a doll trap on the square she just left. After 3 traps, backward moves leave
  nothing.
- **Traps never disappear.** A trap stays until the match ends, even after it has been triggered.
- **What a trap does.** A character that **ends its move on a trap** cannot move or use a skill
  during its owner's **next 1 turn**. After that turn it is free.
- **Whose pieces a trap catches.** It catches the opponent's pieces only; Michelle's own side
  ignores its own traps. **(lead default)**
- **Only landing counts.** A sliding or jumping piece is caught only by the trap on its landing
  square, not by traps it passes over. 피커 is the exception; see below.
- **Traps are visible to both players**, as a doll on the square. **(lead default)**
- **Lost turns.** If every piece a player has left is stunned, or none of them has a legal move,
  that player's turn is passed automatically.
- **Insaner.** If 인세이너 captures Michelle, he absorbs her movement only, not the trap trait.

## 피커 · Picker (`picker`) · 희귀 (rare)

**Look**
- A lone cowboy from the western desert, about 30, styled like a frontier gunslinger.
- He carries a lasso. There is no gun and no cattle in the illustration; just the man alone.

**Voice** **(lead default)**
- A laconic, low, dry frontier drawl from a man in his 30s.

**Movement**
- The 4 diagonals: up-left, up-right, down-left and down-right.
- Range by grade: 1성 1 square, 2성 up to 2, 3성 up to 3.

**Trait: 콩콩 (hop through)**
- **Hops are never blocked.** Picker hops square by square along the diagonal and lands on every
  square on the way. Pieces on the way never block him.
- **Pieces on the way.**
  - An **enemy** on an intermediate square is **captured** as he hops through it.
  - His **own** pieces are hopped over unharmed.
- **The landing square.** It must be empty or hold an enemy, which he captures. He cannot land on
  his own piece, but he can hop past one.
- **Example.** A 3성 Picker taps the 3rd square up-left while an enemy stands on the 2nd. He
  captures that enemy on the way and ends on the 3rd square, not where the enemy was.
- **Wasteland.** He touches every square on his path, so if one of them is wasteland he dies
  there, as any piece touching wasteland does. The move is still legal, and the UI shows the
  deadly marker. **(lead default:** keep this consistent with how the engine already treats
  wasteland for paths.)
- **Enemy traps.** His hop stops at the first enemy doll trap on his path. He may land on it and
  is stunned, but he cannot hop past it. **(lead default:** he touches every square, so the doll
  catches him.)
- **Insaner.** If 인세이너 captures Picker, he absorbs Picker's diagonal RANGE only, as a plain
  slide: blocked by any piece, captures on the landing square only, ends on wasteland, and doll
  traps catch him only where he lands. **(owner rule, 2026-11-04:** 이동 범위만 흡수, 특성·스킬은
  흡수 안 함. It replaces the earlier default that let him absorb the hop-through trait.)
- **Insaner's 3성 extra move.** A multi-capture counts as one capture for that rule.

**Motion**
- On the board, Picker visibly hops square by square in short arcs, with a small "콩" squash on
  each landing.
- Each enemy he hops onto is captured at that moment, with the existing capture FX per victim.
- Both renderers (WebGL and 2D) need this.
- Under reduced motion, the hops are fast and the arcs are flattened.

## Progression
- Michelle and Picker fill the empty arena slots.
  - 미셸 opens in arena 4 (서리 성채) for 30 essence.
  - 피커 opens in arena 5 (광기의 왕좌) for 50 essence.
  - Arena 6 still waits for a future character. **(lead default)**
- Upgrade costs follow rarity, as for everyone:
  - 미셸: 5, then 50 tokens.
  - 피커: 10, then 100 tokens.
- Dungeon squads draw from the whole roster, so both can appear there.

## UI
- **Character info.** Descriptions per grade, role, trait and tier titles go everywhere the other
  characters have them: the collection, hand cards, field panel and tutorial roster.
- **Movement diagrams.** The diagram shows each grade. Picker's diagonals are drawn so they read
  as hops, not slides.
- **On the board:**
  - Trap dolls are tinted with the owner's team colour.
  - A stunned piece shows a clear 속박 marker and a dimmed token.
  - Its hand card shows "속박 · 1턴" and cannot be selected.
- **Coach toasts.** Show a short toast the first time a trap is laid and the first time a piece
  is stunned.

## Decisions to confirm with the owner
1. Traps catch only the opponent's pieces.
2. Traps are visible to both players.
3. A piece is caught only on its landing square, except Picker, who is caught on any square he
   touches, which also ends his hop.
4. Picker dies on wasteland anywhere along his hop path.
5. Michelle opens in arena 4 and Picker in arena 5.
6. Picker's voice is a laconic, low frontier drawl.
