// Promo videos from REAL gameplay: a 9:16 1080x1920 cut and a 16:9 1920x1080 cut (YouTube).
//
// 1. record(): plays the scripted demo match (lib/director.mjs) through the real UI while grabbing
//    2x stills of the phone viewport (CDP Page.captureScreenshot). Headless Chromium renders the
//    WebGL board in software at ~13 fps, so the page clock runs at TIME_SCALE (0.2x) through
//    installTimeWarp + CDP Animation.setPlaybackRate; every frame is stamped and mapped back to the
//    page's own (virtual) time, which gives ~30 real-looking frames per second of gameplay.
//    The game's audio clip starts are logged in the page (director installAudioLog).
// 2. edit(): picks the beats (hook, lobby, VS, hand-card select, Brutile's skill, wasteland + storm,
//    final capture + victory) by marks and logged sounds, at 1x speed with hard cuts.
// 3. ffmpeg: footage -> backdrop + phone bezel + caption cards (rendered from ../video.html with the
//    app's fonts) + end card; soundtrack = the logged public/audio clips at the same moments, mixed,
//    two-pass loudnorm to -16 LUFS / -1.5 dBTP; H.264 High + AAC-LC 48 kHz, +faststart.
// Intermediates live in docs/store-assets/out/raw/video/ (gitignored).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as D from './director.mjs';

const TIME_SCALE = 0.2;
const FPS = 30;
const WORK = resolve(D.STORE_OUT, 'raw/video');
const FRAMES = resolve(WORK, 'frames');
const AUDIO_DIR = resolve(D.ROOT, 'public/audio');
const MAX_BYTES = 15 * 1024 * 1024;

export const OUTPUTS = {
  '9x16': resolve(D.STORE_OUT, 'promo-9x16.mp4'),
  '16x9': resolve(D.STORE_OUT, 'promo-16x9.mp4'),
};

/** Output geometry: where the 780x1560 phone footage goes. */
const LAYOUT = {
  '9x16': { W: 1080, H: 1920, screen: { x: 150, y: 322, w: 780, h: 1560 }, bezel: 14, radius: 44 },
  '16x9': { W: 1920, H: 1080, screen: { x: 1250, y: 40, w: 500, h: 1000 }, bezel: 10, radius: 30 },
};

/**
 * The cut, in order. `from`/`to` are seconds relative to an anchor in the recording (a mark set by
 * record() or the first logged clip whose url matches). Captions: Korean, short, true to the rules.
 * `title16` is the 16:9 line-broken title; `art` is the 16:9 character illustration.
 */
const BEATS = [
  { id: 'hook', anchor: 'sound:sfx/walk-capture', from: -0.55, to: 1.4, eyebrow: '월크 · 기습 점프', title: '뛰어넘어 <em>격파!</em>', title16: '뛰어넘어<br><em>격파!</em>', art: 'walk' },
  { id: 'formation', anchor: 'mark:formTab', from: -0.1, to: null, toAnchor: 'mark:formPick', toOffset: 1.1, eyebrow: '진형 편성', title: '<em>진형</em>이 곧 전략', title16: '<em>진형</em>이<br>곧 전략', art: 'sad' },
  { id: 'lobby', anchor: 'mark:tapStart', from: -1.2, to: 0.55, eyebrow: '1:1 전술 보드게임', title: '말 <em>3</em>개, <em>144</em>칸', title16: '말 <em>3</em>개<br><em>144</em>칸', art: 'insaner' },
  { id: 'versus', anchor: 'mark:versus', from: 0.05, to: 1.5, eyebrow: 'AI와 1:1 대전', title: '한 수 <em>45초</em> 심리전', title16: '한 수 <em>45초</em><br>심리전', art: 'sad' },
  { id: 'select', anchor: 'mark:insanerBegin', from: -0.05, to: null, toAnchor: 'mark:insanerGo', toOffset: 0.95, eyebrow: '카드나 말을 탭', title: '<em>이동 범위</em>가 한눈에', title16: '<em>이동 범위</em>가<br>한눈에', art: 'insaner' },
  { id: 'skill', anchor: 'mark:brutileBegin', from: -0.05, to: null, toAnchor: 'sound:sfx/brutile-skill', toOffset: 1.45, eyebrow: '브루타일 · 전설 스킬', title: '땅을 <em>저주하라</em>', title16: '땅을<br><em>저주하라</em>', art: 'brutile' },
  { id: 'waste', anchor: 'sound:sfx/waste-death', from: -1.1, to: 1.25, eyebrow: '스킬 · 불모지', title: '닿으면 <em>소멸</em>', title16: '닿으면<br><em>소멸</em>', art: 'brutile' },
  { id: 'storm', anchor: 'mark:finalBegin', from: 0.5, to: null, toAnchor: 'mark:finalGo', toOffset: 0, eyebrow: '말 1개 남으면 서든데스', title: '<em>자기장</em>이 좁혀온다', title16: '<em>자기장</em>이<br>좁혀온다', art: 'marki' },
  // Continues the storm beat's source without a cut (seamless): the final capture and the victory.
  { id: 'final', anchor: 'mark:finalGo', from: 0, to: null, toAnchor: 'mark:result', toOffset: 1.9, seamless: true, eyebrow: '승리 조건', title: '모두 잡으면 <em>승리!</em>', title16: '모두 잡으면<br><em>승리!</em>', art: 'marki' },
];
const END_SECONDS = 3.2;

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28, ...opts }).toString();

// ------------------------------------------------------------------------------------ record
async function record(browser, base) {
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  const ctx = await D.newPhoneContext(browser, { audioLog: true });
  await D.installTimeWarp(ctx, TIME_SCALE);
  D.setTimeScale(TIME_SCALE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const marks = {};
  const mark = (k) => (marks[k] = Date.now());
  const frames = [];
  let recording = false;
  let loop = null;
  try {
    await D.openApp(page, base);
    await D.seedMatchmaking(page);
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate', { playbackRate: TIME_SCALE });
    await D.sleep(400);

    recording = true;
    loop = (async () => {
      let n = 0;
      while (recording) {
        const t1 = Date.now();
        const r = await cdp
          .send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true, clip: { x: 0, y: 0, ...D.PHONE, scale: 2 } })
          .catch(() => null);
        const t2 = Date.now();
        if (!r) break;
        const f = `f${String(++n).padStart(5, '0')}.jpg`;
        writeFileSync(resolve(FRAMES, f), Buffer.from(r.data, 'base64'));
        frames.push({ f, real: (t1 + t2) / 2 });
      }
    })();

    await D.sleep(1100); // the lobby, idle
    // 진형 tab: pick up the placed 인세이너 (its legal squares light up), then back to 대전.
    mark('formTab');
    await D.tapTab(page, 'formation');
    await D.sleep(900);
    mark('formPick');
    await page.locator(D.SEL.formationCell(1, 6)).first().click();
    await D.sleep(1300);
    await D.tapTab(page, 'lobby');
    await D.sleep(1300);
    mark('tapStart');
    await D.startMatch(page, 'normal');
    await page.waitForSelector(D.SEL.versusFound, { timeout: 20000 / TIME_SCALE });
    mark('versus');
    await D.waitForMatch(page);
    mark('match');
    await D.scriptBot(page, D.BOT_SCRIPT, 450);
    const [s0, s1, s2, s3, s4, s5] = D.PLAYER_SCRIPT;
    await D.playStep(page, s0);
    await D.playStep(page, { ...s1, viaHand: 'p0-insaner' }, { hooks: { begin: () => mark('insanerBegin'), played: () => mark('insanerGo') } });
    await D.playStep(page, s2, { hooks: { selected: () => mark('walkSel'), played: () => mark('walkGo') } });
    await D.playStep(page, s3, {
      holdMs: 600,
      hooks: {
        // The real "skill unlocked" toast shows at this turn; start the beat once it has gone.
        begin: async () => {
          await page.waitForFunction((t) => !document.querySelector(t), D.SEL.toast, { timeout: 8000 / TIME_SCALE }).catch(() => {});
          mark('brutileBegin');
        },
        played: () => mark('brutileCast'),
      },
    });
    await D.playStep(page, s4);
    // A longer hold on the last selection: the storm chip, the wasteland skull and the capture ring read.
    await D.playStep(page, s5, { holdMs: 2100, hooks: { begin: () => mark('finalBegin'), played: () => mark('finalGo') } });
    await page.waitForSelector(D.SEL.result, { timeout: 15000 / TIME_SCALE });
    mark('result');
    await D.sleep(2600);
    recording = false;
    await loop;
    await D.assertBotOk(page);
    await D.expectPiece(page, 'p1-walk', null);
    await D.expectPiece(page, 'p1-insaner', null);
    await D.expectPiece(page, 'p1-sad', null);
    if (errors.length) throw new Error('page errors: ' + errors.join('; '));
    // Page (virtual) clip times -> wall clock, the time base of the frames and marks.
    const warp = await page.evaluate(() => window.__warp);
    const audio = (await page.evaluate(() => window.__audioLog)).map((a) => ({
      url: a.url,
      real: warp.d0 + (a.t - warp.d0) / warp.scale,
      stopReal: a.stop === undefined ? null : warp.d0 + (a.stop - warp.d0) / warp.scale,
      rate: a.rate,
      gain: a.gain,
    }));
    const session = { scale: TIME_SCALE, frames, marks, audio };
    writeFileSync(resolve(WORK, 'session.json'), JSON.stringify(session, null, 1));
    const span = (frames.at(-1).real - frames[0].real) / 1000;
    console.log(`recorded ${frames.length} frames over ${span.toFixed(1)} s wall clock = ${(span * TIME_SCALE).toFixed(1)} s of gameplay (${(frames.length / (span * TIME_SCALE)).toFixed(1)} fps)`);
    return session;
  } finally {
    recording = false;
    await loop?.catch(() => {});
    D.setTimeScale(1);
    await ctx.close();
  }
}

// ------------------------------------------------------------------------------------ edit
/** Resolve the beats to source windows (gameplay seconds) and output times. */
function edit(session) {
  const R0 = session.frames[0].real;
  const v = (real) => ((real - R0) * session.scale) / 1000;
  const anchorAt = (a) => {
    const [kind, key] = a.split(':');
    if (kind === 'mark') {
      if (session.marks[key] === undefined) throw new Error('missing mark ' + key);
      return v(session.marks[key]);
    }
    const hit = session.audio.find((x) => x.url.startsWith(key));
    if (!hit) throw new Error('missing sound ' + key);
    return v(hit.real);
  };
  let t = 0;
  const beats = BEATS.map((b) => {
    const at = anchorAt(b.anchor);
    const a = at + b.from;
    const end = b.toAnchor ? anchorAt(b.toAnchor) + b.toOffset : at + b.to;
    const dur = Math.round((end - a) * FPS) / FPS;
    if (dur <= 0.3) throw new Error(`beat ${b.id} is empty`);
    const out = { ...b, src: a, dur, start: t };
    t += dur;
    return out;
  });
  const fv = session.frames.map((f) => v(f.real));
  return { beats, endStart: t, total: t + END_SECONDS, fv, v };
}

/** Nearest recorded frame for gameplay time `x` (frames are sorted). */
function nearest(fv, x) {
  let lo = 0;
  let hi = fv.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fv[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(fv[lo - 1] - x) <= Math.abs(fv[lo] - x) ? lo - 1 : lo;
}

function buildFootage(session, cut) {
  const lines = ['ffconcat version 1.0'];
  const add = (i) => lines.push(`file 'frames/${session.frames[i].f}'`, `duration ${(1 / FPS).toFixed(6)}`);
  let last = 0;
  for (const b of cut.beats) {
    const n = Math.round(b.dur * FPS);
    for (let k = 0; k < n; k++) add((last = nearest(cut.fv, b.src + k / FPS)));
  }
  for (let k = 0; k < Math.round(END_SECONDS * FPS); k++) add(last);
  lines.push(`file 'frames/${session.frames[last].f}'`); // concat demuxer: the last duration needs a following entry
  const list = resolve(WORK, 'footage.ffconcat');
  writeFileSync(list, lines.join('\n') + '\n');
  const out = resolve(WORK, 'footage.mp4');
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${FPS},format=yuv420p`, '-t', cut.total.toFixed(3), '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', out]);
  return out;
}

// ------------------------------------------------------------------------------------ audio
function buildSoundtrack(session, cut) {
  // Place every logged clip that starts inside a beat at the same moment of the output.
  const clips = [];
  for (const a of session.audio) {
    const x = cut.v(a.real);
    let b = cut.beats.find((bb) => x >= bb.src - 1e-3 && x < bb.src + bb.dur);
    let at = b ? b.start + (x - b.src) : 0;
    if (!b) {
      // A clip that started just before a cut-in point (e.g. Walk's shout at lift-off, right
      // before the hook's first frame) is moved onto that cut instead of being lost.
      b = cut.beats.find((bb) => !bb.seamless && bb.src - x > 0 && bb.src - x <= 0.3);
      if (!b) continue;
      at = b.start;
    }
    let stop = a.stopReal !== null ? b.start + (cut.v(a.stopReal) - b.src) : null;
    clips.push({ ...a, at, stop, vo: a.url.startsWith('vo/') });
  }
  clips.sort((p, q) => p.at - q.at);
  // One voice at a time, like the game: a new line cuts the previous one.
  for (const [i, c] of clips.entries()) {
    if (!c.vo) continue;
    const next = clips.slice(i + 1).find((d) => d.vo);
    if (next && (c.stop === null || next.at < c.stop)) c.stop = next.at;
  }
  if (!clips.length) throw new Error('no game audio was logged');
  const args = ['-y', '-v', 'error'];
  const parts = [];
  clips.forEach((c, i) => {
    args.push('-i', resolve(AUDIO_DIR, c.url));
    const chain = [`aresample=48000`, `aformat=sample_fmts=fltp:channel_layouts=stereo`];
    if (Math.abs(c.rate - 1) > 1e-3) chain.push(`asetrate=${Math.round(48000 * c.rate)}`, 'aresample=48000');
    chain.push(`volume=${c.gain.toFixed(3)}`);
    if (c.stop !== null && c.stop > c.at) {
      const len = Math.max(0.05, c.stop - c.at);
      chain.push(`atrim=0:${len.toFixed(3)}`, `afade=t=out:st=${Math.max(0, len - 0.06).toFixed(3)}:d=0.06`);
    }
    const ms = Math.round(c.at * 1000);
    chain.push(`adelay=${ms}|${ms}`);
    parts.push(`[${i}:a]${chain.join(',')}[c${i}]`);
  });
  const mixIn = clips.map((_, i) => `[c${i}]`).join('');
  parts.push(`${mixIn}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,apad,atrim=0:${cut.total.toFixed(3)},afade=t=out:st=${(cut.total - 0.6).toFixed(3)}:d=0.6[mix]`);
  const raw = resolve(WORK, 'mix-raw.wav');
  run('ffmpeg', [...args, '-filter_complex', parts.join(';'), '-map', '[mix]', '-c:a', 'pcm_f32le', raw]);
  // Two-pass EBU R128 loudness normalisation to -16 LUFS integrated, -1.5 dBTP.
  const target = 'I=-16:TP=-1.5:LRA=11';
  const p1 = stderrOf(['-hide_banner', '-nostats', '-i', raw, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(p1.slice(p1.lastIndexOf('{'), p1.lastIndexOf('}') + 1));
  const out = resolve(WORK, 'mix.wav');
  run('ffmpeg', [
    '-y', '-v', 'error', '-i', raw, '-af',
    `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`,
    '-c:a', 'pcm_s16le', out,
  ]);
  console.log(`soundtrack: ${clips.length} game clips, ${clips.map((c) => c.url.replace(/\.m4a$/, '')).join(', ')}`);
  return { file: out, clips };
}

/** ffmpeg prints the loudnorm / ebur128 reports on stderr: run it and return that. */
function stderrOf(args) {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr.slice(-2000));
  return r.stderr;
}

// ------------------------------------------------------------------------------------ layers
async function renderLayers(browser, base, cut) {
  const files = {};
  for (const aspect of ['9x16', '16x9']) {
    const L = LAYOUT[aspect];
    const page = await browser.newPage({ viewport: { width: L.W, height: L.H }, deviceScaleFactor: 1 });
    await page.goto(base + '/docs/store-assets/video.html');
    const shoot = async (spec, name, transparent) => {
      const facts = await page.evaluate((s) => window.renderLayer(s), { aspect, ...L, ...spec });
      if (facts.titleRight && (facts.titleRight > L.W - 40 || facts.titleLeft < 40)) throw new Error(`${aspect} caption "${spec.title}" overflows (${facts.titleLeft}-${facts.titleRight})`);
      if (aspect === '16x9' && facts.titleRight > L.screen.x - 30) throw new Error(`16x9 caption "${spec.title}" runs into the phone`);
      const file = resolve(WORK, `${aspect}-${name}.png`);
      await page.screenshot({ path: file, omitBackground: transparent });
      return file;
    };
    files[aspect] = {
      bg: await shoot({ kind: 'bg' }, 'bg', false),
      frame: await shoot({ kind: 'frame' }, 'frame', true),
      end: await shoot({ kind: 'end' }, 'end', false),
      captions: [],
    };
    for (const b of cut.beats) {
      files[aspect].captions.push(await shoot({ kind: 'caption', eyebrow: b.eyebrow, title: aspect === '9x16' ? b.title : b.title16, art: aspect === '16x9' ? b.art : null }, `cap-${b.id}`, true));
    }
    await page.close();
  }
  return files;
}

// ------------------------------------------------------------------------------------ compose
function compose(aspect, footage, layers, soundtrack, cut, crf) {
  const L = LAYOUT[aspect];
  const s = L.screen;
  const T = cut.total.toFixed(3);
  const args = ['-y', '-v', 'error'];
  const img = (f) => args.push('-loop', '1', '-framerate', String(FPS), '-t', T, '-i', f);
  img(layers.bg); // 0
  args.push('-i', footage); // 1
  img(layers.frame); // 2
  img(layers.end); // 3
  layers.captions.forEach((f) => img(f)); // 4..
  const audioIdx = 4 + layers.captions.length;
  args.push('-i', soundtrack.file);
  // A two-frame brightness pop on the footage at each hard cut.
  const cuts = cut.beats.slice(1).filter((b) => !b.seamless).map((b) => `between(t,${b.start.toFixed(3)},${(b.start + 2 / FPS).toFixed(3)})`).join('+');
  const f = [];
  f.push(`[1:v]scale=${s.w}:${s.h}:flags=lanczos,eq=brightness=0.16:enable='${cuts}'[ft]`);
  f.push(`[0:v][ft]overlay=${s.x}:${s.y}:shortest=1[v0]`);
  f.push(`[v0][2:v]overlay=0:0[v1]`);
  let last = 'v1';
  cut.beats.forEach((b, i) => {
    const t0 = b.start;
    const t1 = b.start + b.dur;
    const fin = i === 0 ? '' : `fade=t=in:st=${t0.toFixed(3)}:d=0.18:alpha=1,`; // the hook caption is on from frame 1
    f.push(`[${4 + i}:v]format=rgba,${fin}fade=t=out:st=${(t1 - 0.12).toFixed(3)}:d=0.12:alpha=1[c${i}]`);
    f.push(`[${last}][c${i}]overlay=0:0:enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'[v${i + 2}]`);
    last = `v${i + 2}`;
  });
  f.push(`[3:v]format=rgba,fade=t=in:st=${cut.endStart.toFixed(3)}:d=0.35:alpha=1[end]`);
  f.push(`[${last}][end]overlay=0:0:enable='gte(t,${cut.endStart.toFixed(3)})',format=yuv420p[vout]`);
  const out = OUTPUTS[aspect];
  args.push(
    '-filter_complex', f.join(';'),
    '-map', '[vout]', '-map', `${audioIdx}:a`,
    '-t', T, '-r', String(FPS),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-maxrate', aspect === '9x16' ? '4200k' : '3800k', '-bufsize', '8400k',
    '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', String(FPS * 2),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    out,
  );
  run('ffmpeg', args);
  return out;
}

/** Measured facts about a finished file (ffprobe + ebur128), printed for the report. */
export function probe(file) {
  const j = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,profile,width,height,r_frame_rate,sample_rate,channels', '-of', 'json', file]));
  const e = stderrOf(['-hide_banner', '-nostats', '-i', file, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const sum = e.slice(e.lastIndexOf('Summary:'));
  const num = (re) => Number((sum.match(re) || [])[1]);
  // +faststart: the moov atom comes before mdat.
  const moovFirst = (() => {
    const buf = execFileSync('head', ['-c', '200000', file]);
    const moov = buf.indexOf('moov');
    const mdat = buf.indexOf('mdat');
    return moov >= 0 && (mdat < 0 || moov < mdat);
  })();
  return {
    file,
    bytes: Number(j.format.size),
    duration: Number(j.format.duration),
    streams: j.streams,
    lufs: num(/I:\s+(-?[\d.]+) LUFS/),
    lra: num(/LRA:\s+(-?[\d.]+) LU/),
    truePeak: num(/True peak:\s+Peak:\s+(-?[\d.]+) dBFS/),
    moovFirst,
  };
}

/** Stills for the visual check: raw/video/check-<aspect>-<t>.png. */
function stills(aspect, file, times) {
  for (const t of times) {
    run('ffmpeg', ['-y', '-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', resolve(WORK, `check-${aspect}-${t.toFixed(1)}.png`)]);
  }
}

export async function makePromoVideos(browser, base) {
  mkdirSync(WORK, { recursive: true });
  const session = await record(browser, base);
  const cut = edit(session);
  console.log('beats:', cut.beats.map((b) => `${b.id} ${b.start.toFixed(2)}+${b.dur.toFixed(2)}s`).join(', '), `| end card ${cut.endStart.toFixed(2)}s | total ${cut.total.toFixed(2)}s`);
  const footage = buildFootage(session, cut);
  const soundtrack = buildSoundtrack(session, cut);
  const layers = await renderLayers(browser, base, cut);
  for (const aspect of ['9x16', '16x9']) {
    let crf = 20;
    let file = compose(aspect, footage, layers[aspect], soundtrack, cut, crf);
    while (statSync(file).size > MAX_BYTES && crf < 30) file = compose(aspect, footage, layers[aspect], soundtrack, cut, (crf += 2));
    const p = probe(file);
    const v = p.streams.find((x) => x.codec_name === 'h264');
    const a = p.streams.find((x) => x.codec_name === 'aac');
    console.log(
      `wrote ${file}: ${v.width}x${v.height} ${v.codec_name} ${v.profile} ${v.r_frame_rate} fps, ${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch, ` +
        `${p.duration.toFixed(2)} s, ${(p.bytes / 1048576).toFixed(2)} MB (crf ${crf}), ${p.lufs} LUFS, true peak ${p.truePeak} dBFS, LRA ${p.lra} LU, faststart ${p.moovFirst}`,
    );
    if (p.bytes > MAX_BYTES) throw new Error(`${file} is over 15 MB`);
    const last = cut.beats.at(-1);
    stills(aspect, file, [0.1, 1.2, ...cut.beats.slice(1).map((b) => b.start + Math.min(0.9, b.dur / 2)), last.start + last.dur - 0.4, cut.endStart + 1.5]);
  }
}
