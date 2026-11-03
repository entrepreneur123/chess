import { afterEach, describe, expect, it } from 'vitest';
import {
  DUCK_GAIN,
  MUSIC_LOOPS,
  MUSIC_LOOP_RATE,
  MUSIC_TRACK_IDS,
  SEAM_BLEND_S,
  _gestureForTests,
  _musicStateForTests,
  _resetMusicForTests,
  buildLoopBuffer,
  duckMusic,
  setMusicEnabled,
  setMusicTrack,
} from '../src/audio/music';

// ------------------------------------------------------------------------------------------------
// A minimal fake Web Audio graph: enough for music.ts, and it records what was started.
// ------------------------------------------------------------------------------------------------

class FakeParam {
  value: number;
  events: string[] = [];
  constructor(v: number) {
    this.value = v;
  }
  setValueAtTime(v: number) {
    this.value = v;
    this.events.push(`set ${v}`);
    return this;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
    this.events.push(`ramp ${v}`);
    return this;
  }
  setTargetAtTime(v: number) {
    this.value = v;
    this.events.push(`target ${v}`);
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

class FakeNode {
  connect<T>(n: T): T {
    return n;
  }
  disconnect() {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

class FakeBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private data: Float32Array[];
  tag = '';
  constructor(ch: number, len: number, sr: number) {
    this.numberOfChannels = ch;
    this.length = len;
    this.sampleRate = sr;
    this.data = Array.from({ length: ch }, () => new Float32Array(len));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number) {
    return this.data[c];
  }
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeCtx {
  currentTime = 0;
  sampleRate = 48000;
  state = 'running';
  sources: FakeSource[] = [];
  decoded = 0;
  createGain() {
    return new FakeGain();
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(ch: number, len: number, sr: number) {
    return new FakeBuffer(ch, len, sr);
  }
  /** "Decodes" a tiny buffer; the payload byte 0xFF means corrupt data. */
  decodeAudioData(data: ArrayBuffer): Promise<FakeBuffer> {
    const b = new Uint8Array(data);
    if (b[0] === 0xff) return Promise.reject(new Error('bad data'));
    this.decoded++;
    const buf = new FakeBuffer(2, 4800, 48000);
    buf.tag = String.fromCharCode(...b);
    return Promise.resolve(buf);
  }
  suspend() {
    return Promise.resolve();
  }
  resume() {
    return Promise.resolve();
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

interface Harness {
  ctx: FakeCtx;
  fetched: string[];
  unlocked: boolean;
  settings: boolean;
}

function setup(opts: { unlocked?: boolean; missing?: string[]; corrupt?: string[] } = {}): Harness {
  const h: Harness = { ctx: new FakeCtx(), fetched: [], unlocked: opts.unlocked ?? true, settings: true };
  const out = new FakeGain();
  _resetMusicForTests({
    out: () => (h.unlocked ? { ctx: h.ctx as unknown as AudioContext, out: out as unknown as AudioNode } : null),
    fetchBytes: (url: string) => {
      h.fetched.push(url);
      const id = url.replace(/^.*\/bgm\//, '').replace(/\.m4a$/, '');
      if (opts.missing?.includes(id)) return Promise.resolve(null);
      if (opts.corrupt?.includes(id)) return Promise.resolve(new Uint8Array([0xff]).buffer);
      return Promise.resolve(new TextEncoder().encode(id).buffer as ArrayBuffer);
    },
    settingsAllow: () => h.settings,
    prime: () => {},
    hidden: () => false,
  });
  return h;
}

const started = (h: Harness) => h.ctx.sources.filter((s) => s.started);
const live = (h: Harness) => h.ctx.sources.filter((s) => s.started && !s.stopped);

afterEach(() => _resetMusicForTests());

describe('music module', () => {
  it('lists the six arena tracks', () => {
    expect(MUSIC_TRACK_IDS).toEqual(['moonrune', 'emberforge', 'blightmire', 'frostkeep', 'madcrown', 'apex']);
  });

  it('starts a looping source for a track and is idempotent for the same track', async () => {
    const h = setup();
    setMusicTrack('moonrune');
    await flush();
    expect(started(h)).toHaveLength(1);
    expect(started(h)[0].loop).toBe(true);
    expect(_musicStateForTests().playing).toBe('moonrune');
    setMusicTrack('moonrune');
    setMusicTrack('moonrune');
    await flush();
    expect(started(h)).toHaveLength(1);
    expect(h.fetched).toHaveLength(1);
    // A second rapid request for the same track while it loads does not double-start either.
    const h2 = setup();
    setMusicTrack('apex');
    setMusicTrack('apex');
    await flush();
    expect(started(h2)).toHaveLength(1);
    expect(h2.fetched).toHaveLength(1);
  });

  it('crossfades to a new track: the old source is stopped, one source stays live', async () => {
    const h = setup();
    setMusicTrack('moonrune');
    await flush();
    setMusicTrack('emberforge');
    await flush();
    expect(started(h)).toHaveLength(2);
    expect(live(h)).toHaveLength(1);
    expect(_musicStateForTests().playing).toBe('emberforge');
  });

  it('plays nothing while disabled and resumes the requested track when enabled', async () => {
    const h = setup();
    setMusicEnabled(false);
    setMusicTrack('frostkeep');
    await flush();
    expect(started(h)).toHaveLength(0);
    expect(_musicStateForTests()).toMatchObject({ desired: 'frostkeep', playing: null, enabled: false });
    setMusicEnabled(true);
    await flush();
    expect(started(h)).toHaveLength(1);
    expect(_musicStateForTests().playing).toBe('frostkeep');
    setMusicEnabled(false);
    await flush();
    expect(live(h)).toHaveLength(0);
    expect(_musicStateForTests().playing).toBeNull();
  });

  it('respects the sound/music settings', async () => {
    const h = setup();
    h.settings = false;
    setMusicTrack('madcrown');
    await flush();
    expect(started(h)).toHaveLength(0);
  });

  it('keeps at most two decoded tracks (least recently used is evicted)', async () => {
    const h = setup();
    for (const id of ['moonrune', 'emberforge', 'blightmire']) {
      setMusicTrack(id);
      await flush();
    }
    expect(_musicStateForTests().cached).toEqual(['emberforge', 'blightmire']);
    setMusicTrack('emberforge'); // cached: no new fetch, and it becomes most recent
    await flush();
    expect(h.fetched).toHaveLength(3);
    expect(_musicStateForTests().cached).toEqual(['blightmire', 'emberforge']);
    setMusicTrack('moonrune'); // evicted earlier: fetched again
    await flush();
    expect(h.fetched).toHaveLength(4);
    expect(_musicStateForTests().cached).toEqual(['emberforge', 'moonrune']);
  });

  it('queues a request made before the first user gesture', async () => {
    const h = setup({ unlocked: false });
    setMusicTrack('apex');
    await flush();
    expect(started(h)).toHaveLength(0);
    expect(_musicStateForTests().desired).toBe('apex');
    h.unlocked = true;
    _gestureForTests();
    await flush();
    expect(started(h)).toHaveLength(1);
  });

  it('is a silent no-op for missing or undecodable files', async () => {
    const h = setup({ missing: ['nowhere'], corrupt: ['broken'] });
    expect(() => setMusicTrack('nowhere')).not.toThrow();
    await flush();
    expect(() => setMusicTrack('broken')).not.toThrow();
    await flush();
    expect(started(h)).toHaveLength(0);
    setMusicTrack('broken'); // failures are remembered: no retry storm
    await flush();
    expect(h.fetched.filter((u) => u.endsWith('broken.m4a'))).toHaveLength(1);
  });

  it('null fades the music out', async () => {
    const h = setup();
    setMusicTrack('moonrune');
    await flush();
    setMusicTrack(null);
    await flush();
    expect(live(h)).toHaveLength(0);
  });

  it('ducks about 8 dB and restores', async () => {
    setup();
    setMusicTrack('moonrune');
    await flush();
    duckMusic(true);
    expect(_musicStateForTests().ducked).toBe(true);
    expect(20 * Math.log10(DUCK_GAIN)).toBeCloseTo(-8, 0);
    duckMusic(false);
    expect(_musicStateForTests().ducked).toBe(false);
  });

  it('builds a seamless loop buffer: region copied, tail blended into the pre-roll', () => {
    const ctx = new FakeCtx();
    const sr = 48000;
    // A fake decoded file: [0.512 s pad][loop][0.512 s pad] of a ramp signal.
    const start = 24576;
    const len = 3291136; // moonrune
    const dec = new FakeBuffer(2, start + len + start, sr);
    for (let c = 0; c < 2; c++) {
      const d = dec.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.001 + c);
    }
    const out = buildLoopBuffer(ctx as unknown as BaseAudioContext, dec as unknown as AudioBuffer, 'moonrune') as unknown as FakeBuffer;
    expect(out.length).toBe(len);
    const src = dec.getChannelData(0);
    const o = out.getChannelData(0);
    expect(o[0]).toBe(src[start]);
    expect(o[1000]).toBe(src[start + 1000]);
    // The last sample equals the sample just before loopStart, so last -> first is continuous.
    expect(o[len - 1]).toBeCloseTo(src[start - 1], 6);
    // Before the blend window the loop is untouched.
    const x = Math.round(SEAM_BLEND_S * sr);
    expect(o[len - x - 1]).toBe(src[start + len - x - 1]);
    // Unknown ids (no loop points) loop the whole decoded buffer.
    expect(buildLoopBuffer(ctx as unknown as BaseAudioContext, dec as unknown as AudioBuffer, 'custom')).toBe(dec);
  });
});

// The project has no @types/node: load the few fs helpers through an untyped dynamic import.
interface Fs {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: string): string;
  statSync(p: string): { size: number };
}
const nodeFs = 'node:fs';
const fsP: Promise<Fs> = import(/* @vite-ignore */ nodeFs);
const root = decodeURIComponent(new URL('../', import.meta.url).pathname);

describe('music assets', () => {
  it('ships every track as a small m4a whose loop points match the generator output', async () => {
    const { existsSync, readFileSync, statSync } = await fsP;
    const loops = JSON.parse(readFileSync(`${root}docs/brand/audio/bgm/loops.json`, 'utf8')) as Record<
      string,
      { loopSamples: number; loopStart: number; sampleRate: number; bpm: number; bars: number }
    >;
    expect(Object.keys(loops).sort()).toEqual([...MUSIC_TRACK_IDS].sort());
    for (const id of MUSIC_TRACK_IDS) {
      const f = `${root}public/audio/bgm/${id}.m4a`;
      expect(existsSync(f), f).toBe(true);
      const size = statSync(f).size;
      expect(size, id).toBeGreaterThan(100_000);
      expect(size, id).toBeLessThanOrEqual(700_000);
      const l = loops[id];
      expect(l.sampleRate).toBe(MUSIC_LOOP_RATE);
      expect(MUSIC_LOOPS[id].length, id).toBe(l.loopSamples);
      expect(MUSIC_LOOPS[id].start, id).toBe(Math.round(l.loopStart * l.sampleRate));
      // 60-90 s, a whole number of 4/4 bars at the track's tempo (within the 1024-sample grid).
      const seconds = l.loopSamples / l.sampleRate;
      expect(seconds, id).toBeGreaterThanOrEqual(60);
      expect(seconds, id).toBeLessThanOrEqual(90);
      expect(Math.abs(seconds - (l.bars * 4 * 60) / l.bpm), id).toBeLessThan(1024 / l.sampleRate);
    }
  });
});
