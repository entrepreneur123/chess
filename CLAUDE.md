# Working rules for this repository

- 중단없이 작업한다. (Work without interruption: keep going until the task is fully done; do not stop midway to ask for confirmation on routine decisions — pick sensible defaults and note them in the final report.)
- 작업은 배포까지 중단없이 끝낸다. (Owner, 2026-11-07: every task runs end to end without stopping — implement, verify, commit, push, deploy to production (docs/PROJECT_STATE.md section 5) and check the live site — then report. The owner pre-approves this whole routine, production deploys included; ask first only for something truly critical, e.g. deleting or losing player data, spending money, or changing anything outside this project.)
- All working notes, code, comments, commit messages and docs are written in English.
- Final reports and confirmation requests to the owner are written in Korean.
- Product priorities: for this mobile game, UI, visual design and marketing appeal are the top priorities, on top of correct rules.
- Every change is reviewed for optimization, efficiency, bugs, and gaps versus top-tier commercial mobile apps; never report unverified claims as facts.
- Keep `npx tsc --noEmit -p .`, `npx vitest run` and `npm run build` green before committing.
- Start every session by reading `docs/PROJECT_STATE.md` (compressed state: rules, progression, deploy routine, past bugs, open decisions). Keep it updated when rules or the routine change.
