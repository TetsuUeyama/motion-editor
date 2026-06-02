export * from "./avatar";
export * from "./animator";
export * from "./loader";

// 3D 格闘ゲーム システム (共通契約 + 3 feature)
export * from "./fighting/types";
export {
  loadFightingCharacter,
  type LoadFightingCharacterOptions,
  type FightingCharacter,
  retarget,
  buildNameResolver,
  buildBindingProfile,
  // loader 側の RetargetResult と名前衝突するため別名で公開
  type RetargetResult as BindRetargetResult,
} from "./retarget";
export {
  PoseLayerController,
  LookAtController,
  compileSpineBend,
  applyProceduralPose,
  type PoseRigLike,
  type LookAtOptions,
  type ProceduralPoseResult,
} from "./pose";
export {
  CombatController,
  type CombatStatus,
  type CombatPhase,
  SAMPLE_MOVES,
  SAMPLE_HURTBOXES,
  jab,
  straight,
  hook,
  uppercut,
  midKick,
  highKick,
} from "./combat";
