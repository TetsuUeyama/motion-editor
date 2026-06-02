"use client";

import { useEffect, useState } from "react";
import type {
  Animator,
  AnimatorJson,
  AnimatorParameter,
} from "@/runtime";

interface Props {
  animator: Animator;
  parameters: readonly AnimatorParameter[];
}

/**
 * Animator JSON のパラメータ宣言から動的に UI を組み立てる。
 * Float → スライダー、Bool → チェックボックス、Int → 数値、Trigger → ボタン。
 */
export function AnimatorParameterUI({ animator, parameters }: Props) {
  return (
    <div className="space-y-4">
      {parameters.map((p) => (
        <ParameterRow key={p.name} param={p} animator={animator} />
      ))}
      {parameters.length === 0 && (
        <div className="text-xs text-neutral-500">
          このアセットの Animator にはパラメータがありません。
        </div>
      )}
    </div>
  );
}

function ParameterRow({
  param,
  animator,
}: {
  param: AnimatorParameter;
  animator: Animator;
}) {
  switch (param.type) {
    case "Float":
      return <FloatRow param={param} animator={animator} />;
    case "Int":
      return <IntRow param={param} animator={animator} />;
    case "Bool":
      return <BoolRow param={param} animator={animator} />;
    case "Trigger":
      return <TriggerRow param={param} animator={animator} />;
  }
}

function FloatRow({ param, animator }: { param: AnimatorParameter; animator: Animator }) {
  const [value, setValue] = useState(param.defaultFloat);
  useEffect(() => {
    animator.setFloat(param.name, value);
  }, [animator, param.name, value]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <label>
          {param.name} <span className="text-neutral-500">(Float)</span>
        </label>
        <span className="font-mono text-neutral-300">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={-2}
        max={2}
        step={0.05}
        value={value}
        onChange={(e) => setValue(parseFloat(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

function IntRow({ param, animator }: { param: AnimatorParameter; animator: Animator }) {
  const [value, setValue] = useState(param.defaultInt);
  useEffect(() => {
    animator.setInt(param.name, value);
  }, [animator, param.name, value]);

  return (
    <div className="flex items-center justify-between text-xs">
      <label>
        {param.name} <span className="text-neutral-500">(Int)</span>
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(parseInt(e.target.value || "0", 10))}
        className="w-20 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 font-mono text-neutral-200"
      />
    </div>
  );
}

function BoolRow({ param, animator }: { param: AnimatorParameter; animator: Animator }) {
  const [value, setValue] = useState(param.defaultBool);
  useEffect(() => {
    animator.setBool(param.name, value);
  }, [animator, param.name, value]);

  return (
    <label className="flex cursor-pointer items-center justify-between text-xs">
      <span>
        {param.name} <span className="text-neutral-500">(Bool)</span>
      </span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => setValue(e.target.checked)}
      />
    </label>
  );
}

function TriggerRow({ param, animator }: { param: AnimatorParameter; animator: Animator }) {
  return (
    <button
      type="button"
      onClick={() => animator.setTrigger(param.name)}
      className="w-full rounded-md border border-blue-500/40 bg-blue-500/15 py-1.5 text-xs font-medium text-blue-200 transition hover:bg-blue-500/25"
    >
      {param.name} <span className="text-blue-300/70">(Trigger)</span>
    </button>
  );
}

export function inferAnimatorParameters(
  animatorJson: AnimatorJson | undefined,
): readonly AnimatorParameter[] {
  return animatorJson?.parameters ?? [];
}
