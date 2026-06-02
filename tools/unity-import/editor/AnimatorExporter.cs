using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace MotionEditor
{
    /// <summary>
    /// AnimatorController を MotionEditor の Animator JSON に変換する。
    ///
    /// MVP 範囲:
    ///   - State + Transition
    ///   - Bool / Float / Int / Trigger パラメータ
    ///   - AnyState からの遷移 (anyStateTransitions)
    ///   - duration / exitTime / hasExitTime
    /// 未対応 (将来):
    ///   - SubStateMachine の入れ子
    ///   - BlendTree (1D/2D)
    ///   - Layer Mask / IK / Avatar Mask
    /// </summary>
    public static class AnimatorExporter
    {
        public static AnimatorJson Export(AnimatorController controller)
        {
            if (controller == null)
            {
                throw new System.ArgumentNullException(nameof(controller));
            }

            var json = new AnimatorJson
            {
                name = controller.name,
            };

            foreach (var p in controller.parameters)
            {
                json.parameters.Add(ConvertParameter(p));
            }

            foreach (var layer in controller.layers)
            {
                json.layers.Add(ConvertLayer(layer));
            }

            return json;
        }

        public static void ExportToFile(AnimatorController controller, string outputPath)
        {
            var json = Export(controller);
            var dir = Path.GetDirectoryName(outputPath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }
            File.WriteAllText(outputPath, JsonUtility.ToJson(json, prettyPrint: true));
        }

        private static AnimatorParameterJson ConvertParameter(AnimatorControllerParameter p)
        {
            var dto = new AnimatorParameterJson { name = p.name };
            switch (p.type)
            {
                case AnimatorControllerParameterType.Bool:
                    dto.type = "Bool";
                    dto.defaultBool = p.defaultBool;
                    break;
                case AnimatorControllerParameterType.Float:
                    dto.type = "Float";
                    dto.defaultFloat = p.defaultFloat;
                    break;
                case AnimatorControllerParameterType.Int:
                    dto.type = "Int";
                    dto.defaultInt = p.defaultInt;
                    break;
                case AnimatorControllerParameterType.Trigger:
                    dto.type = "Trigger";
                    dto.defaultBool = p.defaultBool;
                    break;
            }
            return dto;
        }

        private static AnimatorLayerJson ConvertLayer(AnimatorControllerLayer layer)
        {
            var dto = new AnimatorLayerJson
            {
                name = layer.name,
                defaultWeight = layer.defaultWeight,
            };

            var sm = layer.stateMachine;
            if (sm == null) return dto;

            dto.defaultState = sm.defaultState != null ? sm.defaultState.name : null;

            foreach (var child in sm.states)
            {
                dto.states.Add(ConvertState(child.state));
            }

            foreach (var t in sm.anyStateTransitions)
            {
                dto.anyStateTransitions.Add(ConvertTransition(t));
            }

            return dto;
        }

        private static AnimatorStateJson ConvertState(AnimatorState state)
        {
            var clipName = state.motion != null ? state.motion.name : null;
            var loop = true;
            if (state.motion is AnimationClip clip)
            {
                loop = clip.isLooping;
            }

            var dto = new AnimatorStateJson
            {
                name = state.name,
                clip = clipName,
                speed = state.speed,
                loop = loop,
            };

            foreach (var t in state.transitions)
            {
                dto.transitions.Add(ConvertTransition(t));
            }

            return dto;
        }

        private static AnimatorTransitionJson ConvertTransition(AnimatorStateTransition t)
        {
            var dto = new AnimatorTransitionJson
            {
                destination = t.destinationState != null ? t.destinationState.name : null,
                hasExitTime = t.hasExitTime,
                exitTime = t.exitTime,
                duration = t.duration,
            };

            foreach (var c in t.conditions)
            {
                dto.conditions.Add(new AnimatorConditionJson
                {
                    parameter = c.parameter,
                    mode = c.mode.ToString(),
                    threshold = c.threshold,
                });
            }

            return dto;
        }
    }
}
