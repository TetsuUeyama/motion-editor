import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Motion Editor</h1>
      <p className="mt-3 text-neutral-400">
        Unity アセット (FBX / AnimationClip / AnimatorController) を Babylon.js
        ゲームに取り込むためのビルドパイプラインとランタイム。
      </p>

      <section className="mt-10 space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
          Demos
        </h2>
        <ul className="space-y-2">
          <li>
            <Link
              href="/demo/character"
              className="block rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 hover:border-neutral-700"
            >
              <div className="font-medium">Character Animator</div>
              <div className="text-sm text-neutral-400">
                サンプルキャラを Idle / Walk / Run / Attack で動かすデモ
              </div>
            </Link>
          </li>
          <li>
            <Link
              href="/demo/fap"
              className="block rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 hover:border-neutral-700"
            >
              <div className="font-medium">Fighting Animset Pro</div>
              <div className="text-sm text-neutral-400">
                Maskman に FAP の 265 モーションを再バインドして再生
              </div>
            </Link>
          </li>
          <li>
            <Link
              href="/demo/bind"
              className="block rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 hover:border-neutral-700"
            >
              <div className="font-medium">Retarget / Bind（feature 1）</div>
              <div className="text-sm text-neutral-400">
                モーションを指定ボーン / 別モデルへ反映するリターゲット
              </div>
            </Link>
          </li>
          <li>
            <Link
              href="/demo/pose"
              className="block rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 hover:border-neutral-700"
            >
              <div className="font-medium">Pose Layer（feature 2）</div>
              <div className="text-sm text-neutral-400">
                ベース動作に腰の曲げ・腕の角度・注視などの個性を加算
              </div>
            </Link>
          </li>
          <li>
            <Link
              href="/demo/combat"
              className="block rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 hover:border-neutral-700"
            >
              <div className="font-medium">Combat System（feature 3）</div>
              <div className="text-sm text-neutral-400">
                攻撃判定 / 当たり判定 / 発生・硬直・クールタイムのフレーム制御
              </div>
            </Link>
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
          Pipeline
        </h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-300">
          <li>Unity Editor 拡張 (tools/unity-import/editor) で GLB + Animator JSON を出力</li>
          <li>Node CLI (npm run import:unity) で public/assets/ に配置</li>
          <li>Babylon.js Runtime (src/runtime) で読み込み、ステートマシンで再生</li>
        </ol>
      </section>
    </main>
  );
}
