/**
 * One animated unit on the board: an AnimationMixer over a SkeletonUtils clone of a template,
 * logical clip control (idle loop / run / one-shots) and a smoothly tweened facing (yaw).
 */
import * as THREE from 'three';
import type { ClipName } from './config';

export interface PlayOptions {
  /** Cross-fade time in seconds. */
  fade?: number;
  timeScale?: number;
  /** Play once; afterwards fade to `after` (default idle) unless `hold` is set. */
  once?: boolean;
  /** Keep the last frame of a one-shot (death). */
  hold?: boolean;
  /** Start time inside the clip (seconds). */
  at?: number;
}

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class UnitActor {
  /** Yaw pivot: add this to the scene graph. */
  readonly object = new THREE.Group();
  /** Unit height on the board (world units, before the board's own scale). */
  readonly height: number;
  private readonly model: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ClipName, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentName: ClipName | null = null;
  private oneShotLeft = 0;
  private hold = false;
  private yaw = 0;
  private yawFrom = 0;
  private yawTo = 0;
  private yawT = 1;
  private yawDur = 0.25;
  private readonly skeletons: THREE.Skeleton[] = [];

  constructor(model: THREE.Object3D, clips: THREE.AnimationClip[], height: number, phase: number) {
    this.model = model;
    this.height = height;
    this.object.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of clips) this.actions.set(clip.name as ClipName, this.mixer.clipAction(clip));
    model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) this.skeletons.push(sm.skeleton);
    });
    const idle = this.actions.get('idle');
    if (idle) {
      idle.play();
      idle.time = phase * idle.getClip().duration;
      this.current = idle;
      this.currentName = 'idle';
    }
    this.mixer.update(0);
  }

  has(name: ClipName): boolean {
    return this.actions.has(name);
  }

  clipDuration(name: ClipName): number {
    return this.actions.get(name)?.getClip().duration ?? 0;
  }

  /** True while something other than the idle loop is going on (full-rate frames needed). */
  get busy(): boolean {
    return this.yawT < 1 || (this.currentName !== 'idle' && !this.hold);
  }

  play(name: ClipName, opts: PlayOptions = {}): void {
    const next = this.actions.get(name) ?? this.actions.get('idle');
    if (!next) return;
    const fade = opts.fade ?? 0.12;
    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(opts.timeScale ?? 1);
    next.setEffectiveWeight(1);
    if (opts.once) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    }
    if (opts.at) next.time = opts.at;
    next.play();
    if (this.current && this.current !== next) {
      if (fade > 0) this.current.crossFadeTo(next, fade, false);
      else this.current.stop();
    }
    this.current = next;
    this.currentName = name;
    this.hold = !!opts.hold;
    this.oneShotLeft = opts.once
      ? Math.max(0, (next.getClip().duration - (opts.at ?? 0)) / Math.max(0.01, opts.timeScale ?? 1))
      : 0;
  }

  idle(fade = 0.18): void {
    if (this.currentName === 'idle' && !this.hold) return;
    this.play('idle', { fade });
  }

  /** Face a yaw (radians, 0 = +z) over `dur` seconds (0 = snap). */
  face(yaw: number, dur = 0.25): void {
    const target = this.yaw + wrapAngle(yaw - this.yaw);
    if (dur <= 0) {
      this.yaw = this.yawTo = this.yawFrom = target;
      this.yawT = 1;
      this.object.rotation.y = this.yaw;
      return;
    }
    if (Math.abs(target - this.yawTo) < 1e-3 && this.yawT < 1) return;
    if (Math.abs(target - this.yaw) < 1e-3) return;
    this.yawFrom = this.yaw;
    this.yawTo = target;
    this.yawT = 0;
    this.yawDur = dur;
  }

  get facing(): number {
    return this.yawTo;
  }

  /** Advance animation by dt seconds. */
  update(dt: number): void {
    if (this.yawT < 1) {
      this.yawT = Math.min(1, this.yawT + dt / this.yawDur);
      this.yaw = this.yawFrom + (this.yawTo - this.yawFrom) * easeInOut(this.yawT);
      this.object.rotation.y = this.yaw;
    }
    if (this.oneShotLeft > 0) {
      this.oneShotLeft -= dt;
      if (this.oneShotLeft <= 0 && !this.hold) this.idle(0.2);
    }
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const s of this.skeletons) s.dispose();
    this.object.clear();
  }
}
