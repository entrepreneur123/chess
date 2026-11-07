# Voice re-recording brief (성우 재작업 준비)

**Status (2026-11-07, evening): shipped.** The lines were switched off in the morning (the owner judged
the first AI cast too poor) and re-recorded the same day with ElevenLabs: a designed voice per
character, every line directed with `eleven_v4` audio tags and mastered (`README.md`, "Current cast").
`VOICE_LINES_READY = true` again in `src/audio/voice.ts`. This document stays as the per-character
reference of concepts and lines; the direction actually recorded per line is `lines.json` → `v4`
(source: `v4/direction.json`). The owner's acting brief that the cast was directed to: real
professional voice-actor delivery, no robotic cadence, natural sentence endings, pitch / speed /
intensity varied per line, breath and pauses, clean studio sound, one concept-matched voice per
character.

## How to ship the new cast

1. The owner fills in the **owner brief** of each character below (concept, age, tone, references;
   Korean is fine). Rewrite the lines too if wanted.
2. Update `lines.json` per character: `concept`, the `voice` prompt (or a new clone reference in
   `refs/`), and the lines. Keep the event names: they are what the game plays.
3. Record: either the TTS pipeline in `README.md` (`gen_voice.py` → `post_voice.py`), or real voice
   actors (one clean WAV per line id). `post_voice.py` was written for TTS takes (it chooses among
   several sampled takes per line), so real recordings need it adapted, or a plain pass that trims,
   normalises to -16 LUFS / -1 dBTP and encodes AAC `.m4a` under `public/audio/vo/<char>-<id>.m4a`.
4. `python3 write_manifest.py` (writes `src/audio/voiceManifest.ts`), `python3 write_audition.py`,
   and listen to every line at `/audio/audition.html`.
5. Set `VOICE_LINES_READY = true` in `src/audio/voice.ts`. Run the gates (`tests/voice.test.ts`
   checks every character × event has a clip, captions exist and the audio stays under budget).

**Per character, the game plays these events** (variants are picked at random, never twice in a
row): 선택 select · 이동 move (spoken 60% of the time) · 잡기 capture · 스킬/특성 skill · 퇴장 death
· 승리 victory; plus 연쇄 이동 chain (Insaner 3성), 함정 설치 / 발동 trap-set / trap-sprung (Michelle),
다중 잡기 hop-multi (Picker, Verish) and the 타천 awake-* set (Rakaeli). Two or three variants per
frequent event (select, move, capture) keep it from getting repetitive.

**Budget:** all audio together must stay under the limit in `tests/voice.test.ts` (4.25 MiB today);
short lines (0.6–1.6 s) keep the game snappy and the cut-ins in sync.

## Characters

### 사드 `sad` (common)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** Young-adult paladin in gold armour and winged helm, stoic and focused: a warm, clear, confident baritone, heroic but natural, never shouted or shrill.
- **Current lines:**
  - 선택 `select`: 명을 받들겠습니다. / 성검과 함께.
  - 이동 `move`: 전진한다! / 나를 따르라!
  - 잡기 `capture`: 정의의 심판을! / 성검을 받아라! / 물러서라!
  - 스킬/특성 `skill`: 성스러운 빛이여!
  - 퇴장 `death`: 크윽… 여기까지인가…
  - 승리 `victory`: 빛의 승리다!

### 마르키 `marki` (rare)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** A massive armoured bull with lava-cracked hide, snorting steam: a thick, deep, guttural bass with a growl underneath, still intelligible.
- **Current lines:**
  - 선택 `select`: 누구냐. / 피 냄새가 난다.
  - 이동 `move`: 비켜라! / 길을 비켜!
  - 잡기 `capture`: 박살이다! / 날려버린다! / 부숴버린다!
  - 스킬/특성 `skill`: 돌격이다!
  - 퇴장 `death`: 크르륵… 이럴 수가…
  - 승리 `victory`: 약하다! 약해!

### 월크 `walk` (epic)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** A scrappy shield fighter in leather and chainmail (rune armour at lv3), shouting as he charges: a brave man like sad but rougher, darker and lower, steady and terse.
- **Current lines:**
  - 선택 `select`: 준비 완료. / 명령을.
  - 이동 `move`: 간다. / 이동한다.
  - 잡기 `capture`: 방패로 막고, 친다! / 끝이다! / 쓰러뜨렸다!
  - 스킬/특성 `skill`: 도약한다!
  - 퇴장 `death`: 방어선이… 무너졌다…
  - 승리 `victory`: 임무 완수.

### 인세이너 `insaner` (legendary)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** A small purple imp with horns, tail and a manic fanged grin: a sly, wicked creature voice (not a child) under real demonic modulation.
- **Current lines:**
  - 선택 `select`: 키힉… 나를 불렀나? / 이번엔 누굴 괴롭힐까?
  - 이동 `move`: 어디 숨었니~? / 그림자 속으로~
  - 잡기 `capture`: 네 영혼, 맛있겠다! / 키히히히! 잡았다! / 장난 좀 쳐볼까?
  - 스킬/특성 `skill`: 네 힘, 이제 내 거야!
  - 연쇄 이동 `chain`: 한 번 더~!
  - 퇴장 `death`: 크윽… 두고 보자…
  - 승리 `victory`: 전부 내 장난감이야! 키히히!

### 브루타일 `brutile` (legendary)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** A green-skinned, fanged, sneering witch in a horned crown hat: an unmistakably female, aged, raspy, cackling villainess voice with energy.
- **Current lines:**
  - 선택 `select`: 이 늙은이를 불렀느냐? / 흐흐흐… 저주가 필요하냐?
  - 이동 `move`: 어디, 한번 걸어볼까… / 흐흥… 가볼까?
  - 잡기 `capture`: 썩어 문드러져라! / 내 저주를 받아라! / 이히히히! 끝이다!
  - 스킬/특성 `skill`: 이 땅은 죽었다! / 불모지여, 피어나라!
  - 퇴장 `death`: 이… 이럴 리가…
  - 승리 `victory`: 모두 썩어라! 이히히히!

### 미셸 `michelle` (common)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** A gloomy little girl whose long bangs hide her eyes, always holding a doll; she lays doll traps behind her. A quiet, soft, slightly breathy child's voice with a flat, eerie calm: unsettling, never cute, babyish or shrill.
- **Current lines:**
  - 선택 `select`: 불렀어…? / 인형도… 같이 갈래.
  - 이동 `move`: 조용히… 갈게. / 따라오지 마…
  - 잡기 `capture`: 같이 놀자… / 쉿… 이제 잘 시간이야. / 숨바꼭질… 끝.
  - 함정 설치 `trap-set`: 인형이… 기다릴 거야.
  - 함정 발동 `trap-sprung`: 잡았다… 이제 못 움직여.
  - 퇴장 `death`: 인형… 놓치면 안 되는데…
  - 승리 `victory`: 다들… 조용해졌네.

### 피커 `picker` (rare)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** A lone frontier cowboy of about 30 with a lasso who hops diagonally through every square: a laconic, low, dry drawl, calm and confident, a little amused, never shouted.
- **Current lines:**
  - 선택 `select`: 일거리인가. / 말은 짧게 하지.
  - 이동 `move`: 가 보지. / 한 발짝씩.
  - 잡기 `capture`: 올가미에 걸렸군. / 운이 없었군. / 한발 늦었어.
  - 다중 잡기 `hop-multi`: 줄 서. 한 번에 간다.
  - 퇴장 `death`: 여기까지인가… 석양이 좋군.
  - 승리 `victory`: 해 지기 전에 끝났군.

### 라카엘리 `rakaeli` (epic)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** A beautiful, pale blindfolded fallen angel in his late teens (black silk blindfold, cracked dim halo, ash-grey wings) who transforms (타천) into a demon with crimson eyes, horns and flame wings. Base form: a soft, calm, melancholic young male voice with a pretty-boy timbre, elegant, quiet and sorrowful. Transformed form: the same young man, deeper and colder, speaking with a doubled, demonic voice.
- **Current lines:**
  - 선택 `select`: 눈을 가려도… 길은 보여요. / 저를… 부르셨나요.
  - 이동 `move`: 조용히… 내려앉을게요. / 깃털처럼, 가볍게.
  - 잡기 `capture`: 미안해요… 편히 쉬어요. / 빛이 없는 곳으로. / 슬퍼하지 마요.
  - 스킬/특성 `skill`: 하늘이여… 나를 놓아라.
  - 퇴장 `death`: 드디어… 쉴 수 있겠네요.
  - 승리 `victory`: 기도는… 끝났어요.
  - 타천 선택 `awake-select`: 이제야… 보이는군. / 날개가 타오른다.
  - 타천 이동 `awake-move`: 추락은 끝났다. / 불길 속을 걷는다.
  - 타천 잡기 `awake-capture`: 타 버려라. / 구원은 없다.
  - 타천 퇴장 `awake-death`: 또… 떨어지는군.
  - 타천 해제 `awake-end`: 불이… 꺼져 가요.

### 램피드 `rampid` (common)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** An energetic teenage ice boy (~15) with sky-blue hair who rides the ice and dashes straight forward at speed: a bright, quick, cocky young male voice; not a child, not deep.
- **Current lines:**
  - 선택 `select`: 불렀어? 바로 갈게! / 빙판 위라면 내가 최고지.
  - 이동 `move`: 간다, 슝! / 못 따라오지?
  - 잡기 `capture`: 너무 느려! / 꽁꽁 얼려 주지! / 빙판 조심하라고!
  - 퇴장 `death`: 으앗… 미끄러졌다…
  - 승리 `victory`: 역시 내가 제일 빠르다니까!

### 라르헨 `larhen` (common)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** A professional assassin in his thirties with long hair and twin daggers who leaps high: a low, calm, cold, quiet male voice; terse, never shouting.
- **Current lines:**
  - 선택 `select`: 표적을 말해. / 그림자 속에서.
  - 이동 `move`: 조용히. / 위에서 간다.
  - 잡기 `capture`: 끝이다. / 느렸군. / 소리 없이.
  - 퇴장 `death`: …실수였나.
  - 승리 `victory`: 임무 완료.

### 볼코노프 `volkonov` (common)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** A male bard whose eyes are always closed in a smile and who buffs allies with music: a smooth, warm, theatrical, slightly teasing mid-range male voice with a sing-song delivery.
- **Current lines:**
  - 선택 `select`: 오늘은 어떤 노래를 들려줄까? / 후후, 박자에 맞춰 볼까?
  - 이동 `move`: 발걸음도 리듬에 맞춰~ / 라라~ 이쪽이야.
  - 잡기 `capture`: 앙코르는 없어. / 피날레다! / 박자를 놓쳤군.
  - 스킬/특성 `skill`: 모두, 내 선율을 들어라! / 발걸음에 날개를 달아 주지!
  - 퇴장 `death`: 아… 마지막 소절이…
  - 승리 `victory`: 브라보! 완벽한 무대였어.

### 베리쉬 `verish` (rare)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** A pink-haired young woman of about twenty who slides on high-tech power boots and pierces straight through every enemy in her lane: a bright, quick, confident young female voice, playful and sporty, crisp and energetic; not a child, not sultry.
- **Current lines:**
  - 선택 `select`: 준비 완료! 부츠 충전 끝! / 속도라면 자신 있어!
  - 이동 `move`: 따라올 수 있으면 와 봐! / 부스트 온!
  - 잡기 `capture`: 그대로 뚫고 간다! / 길 막지 마! / 정면 돌파!
  - 다중 잡기 `hop-multi`: 한 줄로 전부 꿰뚫었어!
  - 퇴장 `death`: 앗… 여기서 멈추다니…
  - 승리 `victory`: 골인! 오늘도 내가 일등이야!

### 미도스 `midos` (epic)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** A ghost assassin made of living violet-black shadow, not a human: a horned smooth dark mask with glowing slit eyes, a smoke tail instead of legs and three steel claws on each hand; he teleports anywhere. A cool, cold, low and calm male voice, mysterious and quietly menacing, with a ghostly echo; never shouting.
- **Current lines:**
  - 선택 `select`: 그림자는 언제나 네 곁에 있다. / 어둠이 나를 부른다.
  - 이동 `move`: 소리 없이. / 흔적은 남기지 않는다.
  - 잡기 `capture`: 도망칠 곳은 없다. / 그림자에 삼켜져라. / 끝이다.
  - 스킬/특성 `skill`: 어디든, 그림자가 있는 곳이라면. / 눈을 감는 순간, 나는 거기 있다.
  - 퇴장 `death`: 그림자로… 돌아간다…
  - 승리 `victory`: 이 밤은 우리의 것이다.

### 해먼트 `hammont` (rare)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** A huge bearded blacksmith in his thirties with a red bandana and a molten forge hammer who knocks enemies flying: a deep, warm, hearty baritone, boisterous and good-humoured; never shrill.
- **Current lines:**
  - 선택 `select`: 망치 준비 완료다. 누굴 두들겨 줄까? / 불은 충분히 달궈졌다.
  - 이동 `move`: 길 비켜라. / 쿵, 쿵, 간다.
  - 잡기 `capture`: 납작하게 펴 주마. / 뜨거운 맛 좀 봐라. / 한 방이면 끝이지.
  - 스킬/특성 `skill`: 날아가라. / 저리 꺼져.
  - 퇴장 `death`: 화로가… 꺼지는구나…
  - 승리 `victory`: 오늘 일은 이걸로 끝이다.

### 베노아 `venoa` (rare)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** A cool, sharp-eyed young huntress from a poison swamp with a bone longbow and venom arrows: a low-medium, calm, quiet and slightly husky female voice, terse; not a child, not shrill.
- **Current lines:**
  - 선택 `select`: 사냥감은 정했어. / 늪은 내 영역이야.
  - 이동 `move`: 조용히. / 자리를 옮기지.
  - 잡기 `capture`: 명중. / 독이 퍼지는 건 금방이야. / 빗나가는 일은 없어.
  - 퇴장 `death`: 화살이… 다 떨어졌네…
  - 승리 `victory`: 사냥 끝. 돌아가자.

### 글라시아 `glacia` (epic)
- **Owner brief (to fill in):** 컨셉 · 나이대 · 말투 · 참고 목소리 →
- **Current concept (art-derived, to replace):** An elegant young frost witch with long white hair, an icicle-crusted witch hat and ice-skate boots who glides and freezes enemies: a clear, smooth, medium-pitched female voice, aloof and teasing, cold and calm; not a child.
- **Current lines:**
  - 선택 `select`: 차갑게 해 줄까? / 얼음 위는 내 무대야.
  - 이동 `move`: 미끄러지듯이. / 멈추는 건 내가 정해.
  - 잡기 `capture`: 산산조각. / 얼음처럼 부서지렴. / 추웠지?
  - 스킬/특성 `skill`: 얼어붙어. / 거기서 가만히 있어.
  - 퇴장 `death`: 녹아… 버리겠어…
  - 승리 `victory`: 겨울이 이겼네.
