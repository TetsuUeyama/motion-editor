using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace MotionEditor
{
    /// <summary>
    /// Humanoid Avatar の humanDescription から MotionEditor 標準スケルトンに対する
    /// ボーン名マッピング JSON を生成する。
    ///
    /// Unity の HumanBodyBones 名と MotionEditor 標準名は基本的に一致するが、
    /// 一部 (UpperChest 等) は名前が同じなのでそのまま転写する。
    /// </summary>
    public static class AvatarMappingExporter
    {
        public static BoneMappingJson Export(string id, Avatar avatar)
        {
            if (avatar == null)
            {
                throw new System.ArgumentNullException(nameof(avatar));
            }

            if (!avatar.isHuman)
            {
                throw new System.InvalidOperationException(
                    $"Avatar '{avatar.name}' is not Humanoid. Generic rigs need a custom mapping.");
            }

            var json = new BoneMappingJson
            {
                id = id,
                rigType = "unity-humanoid",
            };

            var importerPath = AssetDatabase.GetAssetPath(avatar);
            var importer = AssetImporter.GetAtPath(importerPath) as ModelImporter;
            if (importer == null)
            {
                Debug.LogWarning($"[MotionEditor] Could not find ModelImporter for {importerPath}");
                return json;
            }

            // humanDescription.human: HumanBone[] each with humanName + boneName
            // humanName is the standard Unity name (e.g. "Hips", "LeftUpperArm").
            foreach (var hb in importer.humanDescription.human)
            {
                if (string.IsNullOrEmpty(hb.humanName) || string.IsNullOrEmpty(hb.boneName))
                {
                    continue;
                }

                json.entries.Add(new BoneMappingEntryJson
                {
                    standardName = NormalizeStandardName(hb.humanName),
                    sourceName = hb.boneName,
                });
            }

            return json;
        }

        public static void ExportToFile(string id, Avatar avatar, string outputPath)
        {
            var json = Export(id, avatar);
            var dir = Path.GetDirectoryName(outputPath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }
            File.WriteAllText(outputPath, JsonUtility.ToJson(json, prettyPrint: true));
        }

        /// <summary>
        /// Unity humanName と MotionEditor 標準名の差分を吸収。
        /// 現状ほぼ一致するが、表記揺れに備える。
        /// </summary>
        private static string NormalizeStandardName(string unityHumanName)
        {
            // Unity uses spaces in some legacy names ("Left Upper Leg") in older versions.
            return unityHumanName.Replace(" ", "");
        }
    }
}
