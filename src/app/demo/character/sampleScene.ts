import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

import type { AnimatorJson } from "@/runtime";

/**
 * 実 GLB の代わりに使う、プロシージャルな簡易キャラ + AnimationGroup。
 * Box と Sphere で「胴体・頭・腕・脚」を組んで、Idle / Walk / Run / Attack の
 * 4 種を手で曲線生成する。Animator のロジック検証用。
 */

const FPS = 60;

export interface SampleCharacter {
  root: TransformNode;
  groups: AnimationGroup[];
}

export function setupSampleScene(scene: Scene): SampleCharacter {
  scene.clearColor.set(0.04, 0.05, 0.07, 1);

  const camera = new ArcRotateCamera(
    "camera",
    -Math.PI / 2,
    Math.PI / 2.6,
    6,
    new Vector3(0, 1, 0),
    scene,
  );
  camera.attachControl(undefined, true);
  camera.lowerRadiusLimit = 3;
  camera.upperRadiusLimit = 12;

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.6;

  const dir = new DirectionalLight("dir", new Vector3(-0.5, -1, -0.4), scene);
  dir.intensity = 0.8;

  // 床
  const ground = MeshBuilder.CreateGround("ground", { width: 12, height: 12 }, scene);
  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.15, 0.16, 0.2);
  groundMat.specularColor = Color3.Black();
  ground.material = groundMat;

  // キャラクタ階層
  const character = buildCharacter(scene);

  const groups = [
    buildIdleAnimation(character),
    buildWalkAnimation(character),
    buildRunAnimation(character),
    buildAttackAnimation(character),
  ];

  // 全部止めておく — Animator が必要なものだけ start する
  for (const g of groups) {
    g.stop();
    g.setWeightForAllAnimatables(0);
  }

  return { root: character.root, groups };
}

interface CharacterRig {
  root: TransformNode;
  body: Mesh;
  head: Mesh;
  leftArm: TransformNode;
  rightArm: TransformNode;
  leftLeg: TransformNode;
  rightLeg: TransformNode;
}

function buildCharacter(scene: Scene): CharacterRig {
  const root = new TransformNode("character", scene);

  const body = MeshBuilder.CreateBox(
    "body",
    { width: 0.6, height: 1.0, depth: 0.4 },
    scene,
  );
  body.position.y = 1.1;
  body.parent = root;

  const head = MeshBuilder.CreateSphere(
    "head",
    { diameter: 0.45 },
    scene,
  );
  head.position.y = 1.85;
  head.parent = root;

  const armColor = new Color3(0.4, 0.55, 0.85);
  const bodyMat = new StandardMaterial("bodyMat", scene);
  bodyMat.diffuseColor = new Color3(0.25, 0.35, 0.55);
  body.material = bodyMat;

  const headMat = new StandardMaterial("headMat", scene);
  headMat.diffuseColor = new Color3(0.85, 0.7, 0.55);
  head.material = headMat;

  const leftArm = makeLimb(scene, "leftArm", new Vector3(-0.45, 1.45, 0), armColor);
  leftArm.parent = root;
  const rightArm = makeLimb(scene, "rightArm", new Vector3(0.45, 1.45, 0), armColor);
  rightArm.parent = root;

  const legColor = new Color3(0.2, 0.2, 0.25);
  const leftLeg = makeLimb(scene, "leftLeg", new Vector3(-0.18, 0.6, 0), legColor);
  leftLeg.parent = root;
  const rightLeg = makeLimb(scene, "rightLeg", new Vector3(0.18, 0.6, 0), legColor);
  rightLeg.parent = root;

  return { root, body, head, leftArm, rightArm, leftLeg, rightLeg };
}

function makeLimb(
  scene: Scene,
  name: string,
  pivotWorld: Vector3,
  color: Color3,
): TransformNode {
  // 肩/腰位置にピボットを置き、その下に子メッシュをぶら下げる
  const pivot = new TransformNode(name, scene);
  pivot.position = pivotWorld.clone();

  const limb = MeshBuilder.CreateBox(
    name + "Mesh",
    { width: 0.18, height: 0.7, depth: 0.18 },
    scene,
  );
  limb.parent = pivot;
  limb.position.y = -0.35; // ピボットを上端に

  const mat = new StandardMaterial(name + "Mat", scene);
  mat.diffuseColor = color;
  limb.material = mat;
  return pivot;
}

// -------------------------------------------------------- Animations

function buildIdleAnimation(c: CharacterRig): AnimationGroup {
  const group = new AnimationGroup("Idle");

  // 胴体が小さく上下に揺れる
  group.addTargetedAnimation(
    sineAnim("idle_body_y", "position.y", 1.1, 0.04, 2, 60),
    c.body,
  );
  // 腕がほんの少し前後揺れ
  group.addTargetedAnimation(
    sineAnim("idle_la_x", "rotation.x", 0, 0.08, 2, 60),
    c.leftArm,
  );
  group.addTargetedAnimation(
    sineAnim("idle_ra_x", "rotation.x", 0, 0.08, 2, 60),
    c.rightArm,
  );
  return group;
}

function buildWalkAnimation(c: CharacterRig): AnimationGroup {
  const group = new AnimationGroup("Walk");
  // 足の振り
  group.addTargetedAnimation(
    sineAnim("walk_ll_x", "rotation.x", 0, 0.6, 1, 60),
    c.leftLeg,
  );
  group.addTargetedAnimation(
    sineAnim("walk_rl_x", "rotation.x", 0, -0.6, 1, 60),
    c.rightLeg,
  );
  // 腕は逆位相
  group.addTargetedAnimation(
    sineAnim("walk_la_x", "rotation.x", 0, -0.5, 1, 60),
    c.leftArm,
  );
  group.addTargetedAnimation(
    sineAnim("walk_ra_x", "rotation.x", 0, 0.5, 1, 60),
    c.rightArm,
  );
  // 胴体上下
  group.addTargetedAnimation(
    sineAnim("walk_body_y", "position.y", 1.1, 0.05, 0.5, 60),
    c.body,
  );
  return group;
}

function buildRunAnimation(c: CharacterRig): AnimationGroup {
  const group = new AnimationGroup("Run");
  group.addTargetedAnimation(
    sineAnim("run_ll_x", "rotation.x", 0, 1.1, 0.5, 60),
    c.leftLeg,
  );
  group.addTargetedAnimation(
    sineAnim("run_rl_x", "rotation.x", 0, -1.1, 0.5, 60),
    c.rightLeg,
  );
  group.addTargetedAnimation(
    sineAnim("run_la_x", "rotation.x", 0, -1.0, 0.5, 60),
    c.leftArm,
  );
  group.addTargetedAnimation(
    sineAnim("run_ra_x", "rotation.x", 0, 1.0, 0.5, 60),
    c.rightArm,
  );
  group.addTargetedAnimation(
    sineAnim("run_body_y", "position.y", 1.15, 0.12, 0.25, 60),
    c.body,
  );
  return group;
}

function buildAttackAnimation(c: CharacterRig): AnimationGroup {
  const group = new AnimationGroup("Attack");
  // 右腕を一気に振り下ろす (0 → -1.8 → 0) を 0.4秒で
  const totalFrames = Math.floor(0.4 * FPS);
  const keys = [
    { frame: 0, value: 0 },
    { frame: Math.floor(totalFrames * 0.3), value: -1.8 },
    { frame: Math.floor(totalFrames * 0.7), value: 0.4 },
    { frame: totalFrames, value: 0 },
  ];

  const anim = new Animation(
    "attack_ra_x",
    "rotation.x",
    FPS,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CONSTANT,
  );
  anim.setKeys(keys);
  group.addTargetedAnimation(anim, c.rightArm);

  // 左腕は受けの構え
  const guard = new Animation(
    "attack_la_x",
    "rotation.x",
    FPS,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CONSTANT,
  );
  guard.setKeys([
    { frame: 0, value: 0 },
    { frame: Math.floor(totalFrames * 0.3), value: -0.6 },
    { frame: totalFrames, value: 0 },
  ]);
  group.addTargetedAnimation(guard, c.leftArm);

  group.normalize(0, totalFrames);
  return group;
}

function sineAnim(
  name: string,
  property: string,
  base: number,
  amplitude: number,
  cycleSeconds: number,
  samples: number,
): Animation {
  const totalFrames = Math.floor(cycleSeconds * FPS);
  const keys: { frame: number; value: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const frame = Math.floor(t * totalFrames);
    const value = base + amplitude * Math.sin(t * Math.PI * 2);
    keys.push({ frame, value });
  }
  const anim = new Animation(
    name,
    property,
    FPS,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CYCLE,
  );
  anim.setKeys(keys);
  return anim;
}

// ------------------------------------------------------- Animator JSON

/**
 * Unity Editor 拡張の出力と同じ形式の AnimatorJson を手書きしたサンプル。
 * 実際のパイプラインでは public/assets/<id>/animator.json から読む。
 */
export const SAMPLE_ANIMATOR_JSON: AnimatorJson = {
  name: "SampleCharacterAnimator",
  parameters: [
    { name: "speed", type: "Float", defaultFloat: 0, defaultInt: 0, defaultBool: false },
    { name: "attack", type: "Trigger", defaultFloat: 0, defaultInt: 0, defaultBool: false },
  ],
  layers: [
    {
      name: "Base",
      defaultWeight: 1,
      defaultState: "Idle",
      states: [
        {
          name: "Idle",
          clip: "Idle",
          speed: 1,
          loop: true,
          transitions: [
            {
              destination: "Walk",
              hasExitTime: false,
              exitTime: 0,
              duration: 0.2,
              conditions: [{ parameter: "speed", mode: "Greater", threshold: 0.1 }],
            },
          ],
        },
        {
          name: "Walk",
          clip: "Walk",
          speed: 1,
          loop: true,
          transitions: [
            {
              destination: "Idle",
              hasExitTime: false,
              exitTime: 0,
              duration: 0.2,
              conditions: [{ parameter: "speed", mode: "Less", threshold: 0.1 }],
            },
            {
              destination: "Run",
              hasExitTime: false,
              exitTime: 0,
              duration: 0.2,
              conditions: [{ parameter: "speed", mode: "Greater", threshold: 1.0 }],
            },
          ],
        },
        {
          name: "Run",
          clip: "Run",
          speed: 1,
          loop: true,
          transitions: [
            {
              destination: "Walk",
              hasExitTime: false,
              exitTime: 0,
              duration: 0.2,
              conditions: [{ parameter: "speed", mode: "Less", threshold: 1.0 }],
            },
          ],
        },
        {
          name: "Attack",
          clip: "Attack",
          speed: 1,
          loop: false,
          transitions: [
            {
              destination: "Idle",
              hasExitTime: true,
              exitTime: 0.95,
              duration: 0.15,
              conditions: [],
            },
          ],
        },
      ],
      anyStateTransitions: [
        {
          destination: "Attack",
          hasExitTime: false,
          exitTime: 0,
          duration: 0.05,
          conditions: [{ parameter: "attack", mode: "If", threshold: 0 }],
        },
      ],
    },
  ],
};
