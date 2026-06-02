using System;
using System.Collections.Generic;

namespace MotionEditor
{
    /// <summary>
    /// Babylon.js Runtime 側の `src/runtime/animator/types.ts` と整合する JSON DTO。
    /// 名前を変えるとランタイムが壊れるので注意。
    /// </summary>
    [Serializable]
    public class AnimatorJson
    {
        public string name;
        public List<AnimatorParameterJson> parameters = new List<AnimatorParameterJson>();
        public List<AnimatorLayerJson> layers = new List<AnimatorLayerJson>();
    }

    [Serializable]
    public class AnimatorParameterJson
    {
        public string name;
        public string type;          // "Bool" | "Float" | "Int" | "Trigger"
        public float defaultFloat;
        public int defaultInt;
        public bool defaultBool;
    }

    [Serializable]
    public class AnimatorLayerJson
    {
        public string name;
        public float defaultWeight;
        public string defaultState;
        public List<AnimatorStateJson> states = new List<AnimatorStateJson>();
        public List<AnimatorTransitionJson> anyStateTransitions = new List<AnimatorTransitionJson>();
    }

    [Serializable]
    public class AnimatorStateJson
    {
        public string name;
        public string clip;          // AnimationClip name (= AnimationGroup name in GLB)
        public float speed = 1f;
        public bool loop = true;
        public List<AnimatorTransitionJson> transitions = new List<AnimatorTransitionJson>();
    }

    [Serializable]
    public class AnimatorTransitionJson
    {
        public string destination;
        public bool hasExitTime;
        public float exitTime;
        public float duration;       // seconds
        public List<AnimatorConditionJson> conditions = new List<AnimatorConditionJson>();
    }

    [Serializable]
    public class AnimatorConditionJson
    {
        public string parameter;
        public string mode;          // "If" | "IfNot" | "Greater" | "Less" | "Equals" | "NotEqual"
        public float threshold;
    }

    [Serializable]
    public class BoneMappingJson
    {
        public string id;
        public string rigType;       // "unity-humanoid" or "custom"
        public List<BoneMappingEntryJson> entries = new List<BoneMappingEntryJson>();
    }

    [Serializable]
    public class BoneMappingEntryJson
    {
        public string standardName;  // e.g. "Hips"
        public string sourceName;    // FBX bone name
    }

    [Serializable]
    public class AssetManifestEntry
    {
        public string id;
        public string sourcePath;    // 元の Unity Asset path
        public string glbPath;       // 出力 GLB の相対パス
        public string animatorPath;  // 出力 Animator JSON 相対パス (任意)
        public string boneMappingPath; // 出力 BoneMapping JSON 相対パス (任意)
        public List<string> animationClips = new List<string>();
    }

    [Serializable]
    public class AssetManifestJson
    {
        public string generatedAt;
        public List<AssetManifestEntry> assets = new List<AssetManifestEntry>();
    }
}
