import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import type {
  CharacterRig,
  MoveDefinition,
  HitboxBinding,
  HurtboxBinding,
  HitEvent,
} from "../fighting/types";

/** combat 内部で扱う「ボーン追従の判定球」 */
interface Box {
  /** 追従するボーン */
  bone: TransformNode;
  /** 可視化用ワイヤーフレーム球 (デバッグ表示でだけ enabled) */
  mesh: Mesh;
  radius: number;
  /** ボーンローカルのオフセット */
  offset: Vector3;
}

/** 現在再生中の技の進行状態 */
interface ActiveMove {
  move: MoveDefinition;
  group: AnimationGroup;
  fps: number;
  /** クリップ先頭(group.from)からの経過秒 */
  elapsed: number;
  /** この active 区間でヒット済みの相手 (多段ヒット防止) */
  hitDefenders: Set<CombatController>;
  /** active 終了後の硬直カウントダウン (フレーム) */
  recoveryFramesLeft: number;
  phase: "startup" | "active" | "recovery";
}

export type CombatPhase = "idle" | "startup" | "active" | "recovery";

/** デバッグ HUD などへ返す現在状態 */
export interface CombatStatus {
  moveId: string | null;
  phase: CombatPhase;
  /** クリップ先頭からの現在フレーム (技再生中のみ意味を持つ) */
  frame: number;
  /** クールタイム中の move id → 残りフレーム */
  cooldowns: Record<string, number>;
}

const HITBOX_COLOR = new Color3(0.95, 0.2, 0.2);
const HURTBOX_COLOR = new Color3(0.25, 0.9, 0.35);

/**
 * 1 キャラ分の戦闘制御。
 *
 * - `playMove` で技を発生させ、毎フレーム(`onBeforeRenderObservable`)で
 *   クリップの現在フレームを追跡。startup/active/recovery を遷移させる。
 * - active 区間だけ hitbox を有効化し、相手の hurtbox と球同士で衝突判定。
 * - recovery 中は cancelInto に含まれる技以外は発生不可。move ごとに cooldown 管理。
 * - hitbox(赤)/hurtbox(緑) のワイヤーフレーム可視化を ON/OFF できる。
 *
 * Creator A (retarget) の実装には依存せず、CharacterRig インターフェースのみに依存する。
 */
export class CombatController {
  readonly rig: CharacterRig;
  private readonly scene: Scene;

  private hurtboxes: Box[] = [];
  /** 現在 active な move の hitbox 群 (active 開始時に生成、終了時に dispose) */
  private hitboxes: Box[] = [];

  private active: ActiveMove | null = null;
  /** move id → 残りクールタイム秒 */
  private readonly cooldowns = new Map<string, number>();

  private readonly opponents: CombatController[] = [];
  private readonly hitCallbacks: ((e: HitEvent) => void)[] = [];

  private debugVisible = false;
  private observer: Observer<Scene> | null = null;

  constructor(rig: CharacterRig) {
    this.rig = rig;
    this.scene = rig.scene;
    this.observer = this.scene.onBeforeRenderObservable.add(() => this.update());
  }

  // ---------------------------------------------------------------- setup

  /** 体側ボーンに常時有効な被弾判定(緑)を生成する */
  setupHurtboxes(bindings: HurtboxBinding[]): void {
    for (const b of this.hurtboxes) b.mesh.dispose();
    this.hurtboxes = [];
    for (const binding of bindings) {
      const bone = this.rig.nodesByName.get(binding.bone);
      if (!bone) continue;
      this.hurtboxes.push(
        this.makeBox(binding, bone, "hurtbox", HURTBOX_COLOR),
      );
    }
  }

  /** 衝突判定の相手を登録する (相互には別途呼ぶ) */
  addOpponent(other: CombatController): void {
    if (other !== this && !this.opponents.includes(other)) {
      this.opponents.push(other);
    }
  }

  /** ヒット発生通知を購読する */
  onHit(cb: (e: HitEvent) => void): void {
    this.hitCallbacks.push(cb);
  }

  // ----------------------------------------------------------------- move

  /**
   * 技を発生させる。発生可能なら true。
   * - 別の技が active/startup 中 → 不可
   * - recovery 中 → 現在技の cancelInto に含まれる技のみ可
   * - cooldown 中 → 不可
   */
  playMove(move: MoveDefinition): boolean {
    if (!this.canPlay(move)) return false;

    const group = this.rig.clips.get(move.clip);
    if (!group) return false;

    // 既存の技 (キャンセル含む) を止めて hitbox を片付ける
    this.clearHitboxes();
    group.stop();

    const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    // クリップ全体を 1 回再生 (loop=false)。先頭から流す。
    group.start(false, 1, group.from, group.to, false);
    group.setWeightForAllAnimatables(1);

    this.active = {
      move,
      group,
      fps,
      elapsed: 0,
      hitDefenders: new Set(),
      recoveryFramesLeft: 0,
      phase: "startup",
    };
    this.cooldowns.set(move.id, move.cooldown / fps);
    return true;
  }

  /** その技が今出せるか */
  canPlay(move: MoveDefinition): boolean {
    if ((this.cooldowns.get(move.id) ?? 0) > 0) return false;

    if (this.active) {
      // recovery 中のみ、現在技の cancelInto に含まれていれば許可
      if (this.active.phase === "recovery") {
        return this.active.move.cancelInto?.includes(move.id) ?? false;
      }
      // startup / active 中は新規不可
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------- status

  getStatus(): CombatStatus {
    const cooldowns: Record<string, number> = {};
    for (const [id, sec] of this.cooldowns) {
      if (sec > 0) cooldowns[id] = Math.ceil(sec * 60);
    }
    if (!this.active) {
      return { moveId: null, phase: "idle", frame: 0, cooldowns };
    }
    return {
      moveId: this.active.move.id,
      phase: this.active.phase,
      frame: Math.round(this.currentFrame(this.active)),
      cooldowns,
    };
  }

  /** デバッグ可視化 (hitbox 赤 / hurtbox 緑) の ON/OFF */
  setDebugVisible(visible: boolean): void {
    this.debugVisible = visible;
    for (const b of this.hurtboxes) b.mesh.setEnabled(visible);
    for (const b of this.hitboxes) {
      // active 中の hitbox は active かつ debug の両方が真のときだけ見せる
      b.mesh.setEnabled(visible);
    }
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    this.clearHitboxes();
    for (const b of this.hurtboxes) b.mesh.dispose();
    this.hurtboxes = [];
    this.active = null;
  }

  // ------------------------------------------------------------- internal

  /** 毎フレーム呼ばれる更新 */
  private update(): void {
    const dt = this.scene.getEngine().getDeltaTime() / 1000;

    // クールタイム減算 (active と独立に常時進む)
    for (const [id, sec] of this.cooldowns) {
      const next = sec - dt;
      if (next <= 0) this.cooldowns.delete(id);
      else this.cooldowns.set(id, next);
    }

    if (this.active) {
      this.advanceMove(this.active, dt);
    }
  }

  /** クリップ先頭からの現在フレーム */
  private currentFrame(a: ActiveMove): number {
    return a.group.from + a.elapsed * a.fps;
  }

  private advanceMove(a: ActiveMove, dt: number): void {
    a.elapsed += dt;
    const frame = this.currentFrame(a);
    const [activeFrom, activeTo] = a.move.active;

    if (a.phase === "startup") {
      if (frame >= activeFrom) {
        a.phase = "active";
        this.spawnHitboxes(a.move.hitboxes);
        // この瞬間にも 1 回判定しておく
        this.checkHits(a);
      }
    } else if (a.phase === "active") {
      if (frame > activeTo) {
        // active 終了 → 硬直へ
        this.clearHitboxes();
        a.phase = "recovery";
        a.recoveryFramesLeft = a.move.recovery;
      } else {
        this.checkHits(a);
      }
    } else if (a.phase === "recovery") {
      a.recoveryFramesLeft -= dt * a.fps;
      if (a.recoveryFramesLeft <= 0) {
        // 技完了 — idle へ戻す
        a.group.stop();
        this.active = null;
      }
    }
  }

  /** active 中の hitbox × 相手 hurtbox の衝突を判定し、ヒットを通知する */
  private checkHits(a: ActiveMove): void {
    if (this.hitboxes.length === 0) return;
    for (const opp of this.opponents) {
      if (a.hitDefenders.has(opp)) continue; // この active 区間で既にヒット済み
      if (opp.intersectedByAny(this.hitboxes)) {
        a.hitDefenders.add(opp); // 多段ヒット防止
        const event: HitEvent = {
          move: a.move,
          attacker: this.rig,
          defender: opp.rig,
          frame: Math.round(this.currentFrame(a)),
        };
        for (const cb of this.hitCallbacks) cb(event);
      }
    }
  }

  /** 渡された hitbox 群のいずれかが自分の hurtbox と交差するか (球同士) */
  private intersectedByAny(attackerHitboxes: Box[]): boolean {
    for (const hit of attackerHitboxes) {
      const hp = worldCenter(hit);
      for (const hurt of this.hurtboxes) {
        const dp = worldCenter(hurt);
        const sum = hit.radius + hurt.radius;
        if (Vector3.DistanceSquared(hp, dp) < sum * sum) return true;
      }
    }
    return false;
  }

  private spawnHitboxes(bindings: HitboxBinding[]): void {
    this.clearHitboxes();
    for (const binding of bindings) {
      const bone = this.rig.nodesByName.get(binding.bone);
      if (!bone) continue;
      const box = this.makeBox(binding, bone, "hitbox", HITBOX_COLOR);
      box.mesh.setEnabled(this.debugVisible);
      this.hitboxes.push(box);
    }
  }

  private clearHitboxes(): void {
    for (const b of this.hitboxes) b.mesh.dispose();
    this.hitboxes = [];
  }

  /** ボーン追従のワイヤーフレーム球を作る */
  private makeBox(
    binding: HitboxBinding | HurtboxBinding,
    bone: TransformNode,
    kind: "hitbox" | "hurtbox",
    color: Color3,
  ): Box {
    const offset = new Vector3(
      binding.offset?.[0] ?? 0,
      binding.offset?.[1] ?? 0,
      binding.offset?.[2] ?? 0,
    );
    const mesh = MeshBuilder.CreateSphere(
      `${kind}_${binding.bone}`,
      { diameter: binding.radius * 2, segments: 8 },
      this.scene,
    );
    mesh.parent = bone;
    mesh.position.copyFrom(offset);
    // ボーンのスケールに影響されないよう判定半径は world で評価するが、
    // 見た目はボーンに付けたままで十分 (FAP リグはほぼ等倍)。
    const mat = new StandardMaterial(`${kind}_mat_${binding.bone}`, this.scene);
    mat.wireframe = true;
    mat.emissiveColor = color;
    mat.disableLighting = true;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.setEnabled(kind === "hurtbox" ? this.debugVisible : false);

    return { bone, mesh, radius: binding.radius, offset };
  }
}

/** 判定球のワールド中心 (オフセットをボーン空間で適用) */
function worldCenter(box: Box): Vector3 {
  const m = box.bone.getWorldMatrix();
  return Vector3.TransformCoordinates(box.offset, m);
}
