/**
 * feature1: retarget / bind の公開 API。
 * プロデューサーが最終配線時に runtime/index.ts から再 export する。
 */

export {
  loadFightingCharacter,
  type LoadFightingCharacterOptions,
  type FightingCharacter,
} from "./loadFightingCharacter";

export {
  retarget,
  buildNameResolver,
  buildBindingProfile,
  type RetargetResult,
} from "./retarget";
