using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;
#if MOTION_EDITOR_HAS_UNITYGLTF
using UnityGLTF;
#endif

namespace MotionEditor
{
    /// <summary>
    /// Unity Project Window で選択した Prefab / Model / AnimatorController を
    /// MotionEditor 形式 (GLB + Animator JSON + BoneMapping JSON + manifest) で書き出す。
    ///
    /// 使い方:
    ///   - メニュー: Tools / MotionEditor / Export Selected Assets...
    ///   - CLI: Unity -batchmode -nographics -projectPath . \
    ///          -executeMethod MotionEditor.BatchExporter.ExportFromCommandLine \
    ///          -motionEditorOutput &lt;outputDir&gt; \
    ///          -motionEditorAssets &lt;asset1.prefab,asset2.controller,...&gt; \
    ///          -quit
    ///
    /// 必須: UnityGLTF パッケージ (org.khronos.unitygltf)。
    /// 未インストールだと GLB 出力部分は警告だけ出してスキップする。
    /// </summary>
    public static class BatchExporter
    {
        private const string MenuRoot = "Tools/MotionEditor/";

        // ------------------------------------------------------------ Menu

        [MenuItem(MenuRoot + "Export Selected Assets...")]
        public static void ExportSelectedFromMenu()
        {
            var output = EditorUtility.SaveFolderPanel(
                "Select MotionEditor output folder", "", "");
            if (string.IsNullOrEmpty(output)) return;

            var assets = GetSelectedAssetPaths();
            if (assets.Count == 0)
            {
                EditorUtility.DisplayDialog("MotionEditor",
                    "Select prefabs, models, or AnimatorControllers in the Project window first.",
                    "OK");
                return;
            }

            ExportAssets(assets, output);
            EditorUtility.RevealInFinder(output);
        }

        // ----------------------------------------------------- Command line

        public static void ExportFromCommandLine()
        {
            var args = Environment.GetCommandLineArgs();
            string output = null;
            string assetCsv = null;

            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "-motionEditorOutput" && i + 1 < args.Length)
                {
                    output = args[++i];
                }
                else if (args[i] == "-motionEditorAssets" && i + 1 < args.Length)
                {
                    assetCsv = args[++i];
                }
            }

            if (string.IsNullOrEmpty(output))
            {
                throw new ArgumentException("-motionEditorOutput is required");
            }

            List<string> assetPaths;
            if (string.IsNullOrEmpty(assetCsv))
            {
                // 引数がない場合は Assets/ 以下の Prefab/Model/Controller をすべて対象にする
                assetPaths = FindAllExportableAssets();
            }
            else
            {
                assetPaths = new List<string>(assetCsv.Split(','));
            }

            ExportAssets(assetPaths, output);
        }

        // -------------------------------------------------------- Internals

        private static List<string> GetSelectedAssetPaths()
        {
            var result = new List<string>();
            foreach (var obj in Selection.objects)
            {
                var path = AssetDatabase.GetAssetPath(obj);
                if (!string.IsNullOrEmpty(path)) result.Add(path);
            }
            return result;
        }

        private static List<string> FindAllExportableAssets()
        {
            var result = new List<string>();
            foreach (var guid in AssetDatabase.FindAssets("t:Prefab t:Model t:AnimatorController"))
            {
                result.Add(AssetDatabase.GUIDToAssetPath(guid));
            }
            return result;
        }

        private static void ExportAssets(List<string> assetPaths, string outputDir)
        {
            Directory.CreateDirectory(outputDir);

            var manifest = new AssetManifestJson
            {
                generatedAt = DateTime.UtcNow.ToString("o"),
            };

            for (int i = 0; i < assetPaths.Count; i++)
            {
                var path = assetPaths[i].Trim();
                if (string.IsNullOrEmpty(path)) continue;

                EditorUtility.DisplayProgressBar(
                    "MotionEditor Export",
                    path,
                    (float)i / Math.Max(1, assetPaths.Count));

                try
                {
                    var entry = ExportSingle(path, outputDir);
                    if (entry != null) manifest.assets.Add(entry);
                }
                catch (Exception e)
                {
                    Debug.LogError($"[MotionEditor] Failed to export {path}: {e}");
                }
            }

            EditorUtility.ClearProgressBar();

            File.WriteAllText(
                Path.Combine(outputDir, "assets-manifest.json"),
                JsonUtility.ToJson(manifest, prettyPrint: true));

            Debug.Log($"[MotionEditor] Exported {manifest.assets.Count} asset(s) to {outputDir}");
        }

        private static AssetManifestEntry ExportSingle(string assetPath, string outputDir)
        {
            var assetType = AssetDatabase.GetMainAssetTypeAtPath(assetPath);
            if (assetType == null) return null;

            var id = SanitizeId(Path.GetFileNameWithoutExtension(assetPath));
            var assetOutDir = Path.Combine(outputDir, id);
            Directory.CreateDirectory(assetOutDir);

            var entry = new AssetManifestEntry
            {
                id = id,
                sourcePath = assetPath,
            };

            // 1) AnimatorController only
            if (typeof(AnimatorController).IsAssignableFrom(assetType))
            {
                var controller = AssetDatabase.LoadAssetAtPath<AnimatorController>(assetPath);
                var animatorPath = Path.Combine(assetOutDir, "animator.json");
                AnimatorExporter.ExportToFile(controller, animatorPath);
                entry.animatorPath = ToRelative(outputDir, animatorPath);
                return entry;
            }

            // 2) Model / Prefab — ロードして GLB + 付随情報を出す
            var go = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
            if (go == null) return null;

            // AnimationClip 一覧 (GLB へ焼き込むため先に収集する)
            var clips = new List<AnimationClip>();
            foreach (var sub in AssetDatabase.LoadAllAssetsAtPath(assetPath))
            {
                if (sub is AnimationClip clip && !clip.name.StartsWith("__preview__"))
                {
                    clips.Add(clip);
                    entry.animationClips.Add(clip.name);
                }
            }

            // GLB 出力 (クリップを一時 AnimatorController 経由で焼き込む)
            var glbPath = Path.Combine(assetOutDir, id + ".glb");
            if (TryExportGlb(go, assetOutDir, id, clips))
            {
                entry.glbPath = ToRelative(outputDir, glbPath);
            }

            // Humanoid Avatar からのボーンマッピング
            var avatar = FindAvatar(assetPath);
            if (avatar != null && avatar.isHuman)
            {
                var mappingPath = Path.Combine(assetOutDir, "bone-mapping.json");
                AvatarMappingExporter.ExportToFile(id, avatar, mappingPath);
                entry.boneMappingPath = ToRelative(outputDir, mappingPath);
            }

            return entry;
        }

        // GLB へクリップを焼く際に一時的に作る AnimatorController の置き場所。
        private const string TempControllerPath =
            "Assets/MotionEditor/__MotionEditorTempExport.controller";

        private static bool TryExportGlb(
            GameObject go,
            string outDir,
            string fileName,
            IReadOnlyList<AnimationClip> clips)
        {
#if MOTION_EDITOR_HAS_UNITYGLTF
            GameObject instance = null;
            var attachedTempController = false;
            try
            {
                // UnityGLTF: シーン上ではなく Prefab を直接エクスポートするため一時的にインスタンス化。
                instance = (GameObject)PrefabUtility.InstantiatePrefab(go);

                // AnimationClip を一時 AnimatorController として Animator に割り当てると、
                // UnityGLTF が SaveGLB 時に Humanoid サンプリングで各クリップを焼き込む。
                // (これをしないと GLB にスケルトンだけが入り、アニメ曲線が出ない)
                if (clips != null && clips.Count > 0)
                {
                    var animator = instance.GetComponent<Animator>()
                        ?? instance.GetComponentInChildren<Animator>();
                    if (animator != null)
                    {
                        var baseCtrl = AnimatorController.CreateAnimatorControllerAtPath(TempControllerPath);
                        foreach (var clip in clips)
                        {
                            if (clip != null) baseCtrl.AddMotion(clip);
                        }
                        // AnimatorOverrideController でラップして割り当てる。
                        // UnityGLTF の ExportAnimationFromNode は runtimeAnimatorController を
                        // `as AnimatorController` で判定するため、Override だと null となり
                        // 「controller なし経路」を通る。これにより AnimatorState を走査する経路
                        // (GetAnimatorStateParametersForClip) を回避でき、Humanoid サンプリングの
                        // AnimationMode リロードで State 参照が破棄されて落ちる問題を防ぐ。
                        // クリップ一覧は AnimationUtility.GetAnimationClips が Override 経由で取得する。
                        var overrideCtrl = new AnimatorOverrideController(baseCtrl);
                        animator.runtimeAnimatorController = overrideCtrl;
                        attachedTempController = true;
                    }
                    else
                    {
                        Debug.LogWarning(
                            $"[MotionEditor] No Animator on {go.name}; {clips.Count} clip(s) will not be baked into GLB.");
                    }
                }

                var settings = GLTFSettings.GetOrCreateSettings();
                settings.ExportAnimations = true;
                var exportContext = new ExportContext(settings);
                var exporter = new GLTFSceneExporter(
                    new[] { instance.transform },
                    exportContext);
                exporter.SaveGLB(outDir, fileName);
                return true;
            }
            catch (Exception e)
            {
                Debug.LogError($"[MotionEditor] GLB export failed for {go.name}: {e}");
                return false;
            }
            finally
            {
                if (instance != null) UnityEngine.Object.DestroyImmediate(instance);
                if (attachedTempController) AssetDatabase.DeleteAsset(TempControllerPath);
            }
#else
            Debug.LogWarning(
                "[MotionEditor] UnityGLTF (org.khronos.unitygltf) is not installed; skipping GLB export. " +
                "Install via Package Manager: https://github.com/KhronosGroup/UnityGLTF");
            return false;
#endif
        }

        private static Avatar FindAvatar(string assetPath)
        {
            foreach (var sub in AssetDatabase.LoadAllAssetsAtPath(assetPath))
            {
                if (sub is Avatar avatar) return avatar;
            }
            return null;
        }

        private static string ToRelative(string root, string fullPath)
        {
            return fullPath.Substring(root.Length).TrimStart('/', '\\').Replace('\\', '/');
        }

        private static string SanitizeId(string raw)
        {
            var chars = raw.ToCharArray();
            for (int i = 0; i < chars.Length; i++)
            {
                if (!char.IsLetterOrDigit(chars[i]) && chars[i] != '-' && chars[i] != '_')
                {
                    chars[i] = '_';
                }
            }
            return new string(chars).ToLowerInvariant();
        }
    }
}
