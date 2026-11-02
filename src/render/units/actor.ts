/**
 * One animated unit on the board: an AnimationMixer over a SkeletonUtils clone of a template,
 * logical clip control (idle loop / run / one-shots), a smoothly tweened facing (yaw) and
 * procedural secondary motion (cape / scarf / pennant / wings / plume bones: idle sway plus a
 * flare that eases in while the unit runs or jumps). Allocation-free per frame.
 */
import * as THREE from 'three';
import type { ClipName } from './config';
import type { SecondarySpec } from './outfits';

export interface ActorOptions {
  secondary?: SecondarySpec[];
  /** Idle clip speed (Lv3 "power" idle). */
  idleSpeed?: number;
  /** Hover/breathe bob of the rig (tile units, before the board scale). */
  bob?: number;
  /** Objects hidden while dying (particles, rune, shaft). */
  fx?: THREE.Object3D[];
}

interface SecondaryBone {
  bone: THREE.Bone;
  base: THREE.Quaternion;
  axis: THREE.Vector3;
  spec: SecondarySpec;
}

const tmpQ = new THREE.Quaternion();

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
  private readonly secondary: SecondaryBone[] = [];
  private readonly idleSpeed: number;
  private readonly bob: number;
  private readonly rig: THREE.Object3D | null;
  private readonly fx: THREE.Object3D[];
  private readonly meshes: THREE.SkinnedMesh[] = [];
  private readonly liveMaterials: THREE.Material[] = [];
  private clock = 0;
  private moving = 0;

  constructor(model: THREE.Object3D, clips: THREE.AnimationClip[], height: number, phase: number, opts: ActorOptions = {}) {
    this.model = model;
    this.height = height;
    this.idleSpeed = opts.idleSpeed ?? 1;
    this.bob = opts.bob ?? 0;
    this.fx = opts.fx ?? [];
    this.rig = model.children[0] ?? null;
    this.clock = phase * 10;
    this.object.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of clips) this.actions.set(clip.name as ClipName, this.mixer.clipAction(clip));
    model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) {
        this.skeletons.push(sm.skeleton);
        this.meshes.push(sm);
        this.liveMaterials.push(sm.material as THREE.Material);
      }
    });
    for (const spec of opts.secondary ?? []) {
      const bone = model.getObjectByName(spec.bone) as THREE.Bone | undefined;
      if (!bone) continue;
      this.secondary.push({ bone, base: bone.quaternion.clone(), axis: new THREE.Vector3(...spec.axis).normalize(), spec });
    }
    const idle = this.actions.get('idle');
    if (idle) {
      idle.setEffectiveTimeScale(this.idleSpeed);
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
    next.setEffectiveTimeScale(opts.timeScale ?? (name === 'idle' ? this.idleSpeed : 1));
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

  /** Swap the body material (death dissolve) or restore it (null); hides/shows the unit FX. */
  setDying(material: THREE.Material | null): void {
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i].material = material ?? this.liveMaterials[i];
    for (const o of this.fx) o.visible = !material;
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
    this.updateSecondary(dt);
  }

  private updateSecondary(dt: number): void {
    this.clock += dt;
    const mv = this.currentName === 'run' || this.currentName === 'jump' ? 1 : this.currentName === 'attack' ? 0.5 : 0;
    this.moving += (mv - this.moving) * Math.min(1, dt * 7);
    const t = this.clock;
    for (let i = 0; i < this.secondary.length; i++) {
      const s = this.secondary[i];
      const sp = s.spec;
      const flutter = 1 + this.moving * 1.6;
      const ang =
        sp.run * this.moving + sp.idleAmp * flutter * Math.sin(t * sp.idleFreq * (1 + this.moving) * Math.PI * 2 + sp.phase);
      tmpQ.setFromAxisAngle(s.axis, ang);
      s.bone.quaternion.copy(s.base).multiply(tmpQ);
    }
    if (this.rig && this.bob > 0) {
      this.rig.position.y = this.restY + this.bob * (1 - this.moving) * (0.5 + 0.5 * Math.sin(t * 2.2));
    }
  }

  private get restY(): number {
    return (this.rig?.userData.restY as number | undefined) ?? 0;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const s of this.skeletons) s.dispose();
    this.setDying(null);
    this.object.clear();
  }
}
