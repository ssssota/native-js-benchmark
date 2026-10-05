# Oseo / Porffor / Static Hermes / Perry / scriptc の比較

2026-10-05、Apple M1、macOS arm64。保存データ:
[native-comparison-results.json](native-comparison-results.json)。
今回のC/IRと各プロセスの測定値は `build/native-comparison-2026-10-05/`。
Oseo/Nodeは前回の実行物を再利用し、時間を今回のパスで測り直した。
[前回のOseo調査](oseo-benchmark.md)と[オブジェクトの対照実験](object-shapes-benchmark.md)は保存したまま。

## 実行性能

同じ元ワークロード・同じ計測方法で3ラウンドを直列実行。
各条件は新しいプロセスで2バッチwarmup、5バッチ測定。
pilotで約100msを目標に呼出し数を調整し、バッチ時間を呼出し数で割る。
表は3プロセスの中央値の中央値、単位ms。時計は `Date.now()` の1ms単位。
各ワークロードの初期化も含む。primesは100,000まで、jsonは1,000レコード×100回、
objectは256個・8キー・200,000更新。

コンパイラの標準設定を比べる表であり、最適化・sanitizerの設定を統一した比較ではない。
Oseo標準は生成Cに最適化指定なし、ランタイムO2、ASan/UBSanあり。
他はこのリポジトリの通常のrelease用コマンド。scriptcはLLVMが標準で、C経路も別途測定した。
OseoのO2/sanitizerなしは実験条件で、通常のtool設定は変更していない。

| 実行系                            | primes |   json |  object-stable |   object-churn |
| --------------------------------- | -----: | -----: | -------------: | -------------: |
| Node                              |   6.53 |  36.67 |           8.25 |          15.83 |
| Static Hermes JS                  |   6.18 |  47.00 |          26.00 |          44.67 |
| Perry JS                          |  10.75 | 186.00 |          36.00 |         998.00 |
| Porffor JS                        |  91.50 | 182.00 |          13.50 |          14.57 |
| scriptc JS、LLVM                  |  90.00 |  91.00 | 意味論検査失敗 | 意味論検査失敗 |
| scriptc JS、C                     |  91.00 |  95.50 | 意味論検査失敗 | 意味論検査失敗 |
| Oseo JS、標準                     |  1,677 |  4,074 |          1,374 |          1,302 |
| Oseo JS、生成CもO2・sanitizerなし |    662 |      — |              — |            564 |

今回の範囲では、Porfforはオブジェクト更新に強く、Static Hermes/Perryはprimesで速い。
Cへの変換が共通でも、ワークロードによって順位が変わる。
Oseoは今回の他のネイティブ実行系より遅く、O2/sanitizerなしの対照でも差が残る。
scriptcのC/LLVM差は、数値演算と動的変換の下ろし方の差より小さかった。

独立プロセスの中央値の範囲もJSONに保存した。例:
Porffor primes 90.5–118ms、Perry churn 983–1,120ms、Oseo primes 1,537–1,819ms。
Hermes stableは25.75–59ms、scriptc C jsonは85.5–148msと揺れた。
Node jsonも35.33–61.33ms。細かい順位や数%の差を確定する測定ではない。
現在のホストはバッテリー駆動、battery側のlowpowermode設定は1。
CPU・温度・周波数を固定していない。この状態は記録したが、以前の値との差の原因とは断定しない。

primesの注釈付き対照は、Hermes Flow 6.67ms、Perry TS 11.00ms、scriptc TS 91.00ms。
このプログラムでは注釈追加だけによる速度向上は観測しなかった。
scriptc TSだけは計測用durations配列を `number[]` とした。注釈なしではハーネスの配列が
`any[]`として拒否されたためで、元のprimesの型注釈とアルゴリズムは保持している。

helloは別の起動込みの測定。各ラウンド3回warmup、15回spawn-to-exit、`hrtime`。
scriptc LLVM 2.78ms、Porffor 3.21ms、scriptc C 3.28ms、Oseo 4.54ms、
Perry 5.08ms、Static Hermes 8.61ms、Node 47.45ms。
定常処理の性能とは分けて読む。

### scriptcのobjectを順位から外した理由

次の参照更新検査はPorffor/Hermes/Perryで9、scriptc JSのLLVM/C両経路で0。
このパターンのobject性能は、同じ参照意味論を実装した比較として扱えないため測定をスキップした。

```js
const objects = [];
objects.push({ a: 0, b: 0 });
const object = objects[0];
object.a = 9;
console.log(objects[0].a);
```

scriptc TSで配列を明示的なrecord配列にした診断は9を出した。
以前の[全配列変換の追試](object-shapes-benchmark.md#4-scriptc-628倍差の主因を切り分ける)
と整合する。今回はJS推論版の失敗を、scriptcの全ての表現やTS版の失敗へ一般化しない。
成功した時間の測定は全てchecksumを確認したが、この有限個の検査はJS全体への適合性証明ではない。

## コンパイル方式

「Cを経るか」「C/LLVMを出す前にどんな値・操作へ下ろすか」「残るJS操作のランタイム」を
別々に見ると違いを説明しやすい。

| ツール          | 今回のネイティブ経路                                      | 値・操作の下ろし方                                                                |
| --------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Oseo            | Babel → HIR → MIR → C → Zig cc、Cランタイムをリンク       | 汎用値・環境・セル・status検査を保ち、適格な場所だけガード付き特殊化              |
| Porffor alpha 6 | 独自parser/IR → C → C compiler                            | 数値と判定できるローカルをf64等へ下ろす。必要なbuiltinとGCのコードも生成Cに含める |
| Static Hermes   | Hermesの最適化IR → C → C compiler、Hermes runtimeをリンク | 数値演算や高速経路をインラインCにする。動的object/builtin/GCはランタイムが担当    |
| Perry 0.5.1520  | SWC → HIR → LLVM IR → native、native runtimeをリンク      | 数値演算とガードをLLVMへ直接出し、残る動的処理をruntimeへ下ろす                   |
| scriptc 0.0.36  | TypeScript frontend → typed IR → LLVM、または明示的にC    | 静的数値・record・arrayと汎用値を使い分ける。境界に変換・retain/releaseが現れる   |

Porffor alpha 6は[当該revisionのREADME](https://github.com/CanadaHonk/porffor/blob/alpha-6/README.md)
でIRを経てCへ進むと説明している。今回の経路にWasm→Cの工程はない。
古いPorfforのWasm指向の説明と、今回使ったalpha 6を混ぜない。
生成Cでも `jsval { f64 val; i32 type; }` とpackedな `jsbits`、
数値ローカルの `f64`、arenaと `PORF_GC_ENABLED 1` を確認した。
全ての値をdoubleだけで表すという意味ではない。
現在の[公式compiler説明](https://porffor.dev/docs/compiler.html)にも、数値ローカルの非boxed化と
必要なbuiltinを生成Cへ含める経路が説明されている。

Static Hermesは[開発者の説明](https://github.com/facebook/hermes/discussions/1685)どおり、
Hermesのコンパイラパイプラインの先でbytecodeの代わりにCを出す。
今回のプログラムをbytecodeインタプリタで実行したわけではない。
一方でJSオブジェクトやGC等のランタイムはリンクされる。
`shermes --version` のLLVH表記は、プログラムをLLVM IRへ直接出したことを意味しない。

Perryは[現在のREADME](https://github.com/PerryTS/perry)と実際の保存 `.ll` の双方でLLVM経路を確認。
生成Cをコンパイルする方式ではない。数値はLLVMの `double` / 整数演算で扱い、
動的値にはNaN-box表現とnative runtimeを使う。
Perryの[LLVM移行記録](https://perryts.com/en/blog/cranelift-to-llvm)も、
runtimeへの不透明な呼出しとインラインloweringの境界が性能を左右した例を説明している。
そのページの過去の速度倍率を、今回の測定の根拠には用いていない。

scriptcは[v0.0.36のREADME](https://github.com/vercel-labs/scriptc/blob/v0.0.36/README.md)
とCLI helpでLLVM標準を確認。このmacOS arm64の通常経路はbundled helperとprecompiled runtime packを使う。
`--keep-c` という名前でも、LLVM経路では保存されるprogram TUは `.ll`。
`--backend c` は別に指定して今回測定した。
`ScrDyn` は生成物に現れるscriptcの汎用値であり、その存在だけでQuickJS実行を意味しない。
QuickJS-ngを埋め込む `--dynamic` は別のモードで、今回指定していない。

Oseoは[READMEの設計説明](https://github.com/dahlia/oseo/blob/317b58bbe686219ed9b715473c91ee2e9b5c5817/README.md)
にあるとおり、型注釈を検査の代わりにはせず、ガード付き最適化ヒントとして扱う。
ガードが失敗すれば、既にコンパイルされた汎用経路へ進む。
型チェックを行うscriptcのfrontendとはここも異なる。
ただし設計上特殊化できることと、今回のループに実際に特殊化が生成されることは別。

## 性能差を説明する具体例: primesの剰余

元コードは `candidate % divisor === 0`。保存したC/IRでは次の違いがある。

| ツール         | 今回生成された経路                                                                  |
| -------------- | ----------------------------------------------------------------------------------- |
| Oseo           | environment/cellから値を取得 → `oseo_remainder` 等の汎用演算 → status検査とroot保存 |
| Porffor        | f64のcandidate/divisor → `fmod(candidate, divisor)`                                 |
| scriptc LLVM/C | doubleのローカル → `fmod`。JS版のlimitには汎用値から数値への変換も残る              |
| Perry          | 整数の範囲・正確性・0除算を検査 → `srem i32`、fallbackは `frem double`。負の0も処理 |
| Static Hermes  | インラインの `_sh_mod_double` → uint32条件で整数 `%`、fallbackは `fmod`             |

Hermesの[当該header](https://github.com/facebook/hermes/blob/7508017ae267ecffe4c4df38656713034f35d9bf/include/hermes/VM/static_h.h#L1026)
で整数高速経路を確認し、インストール済みheaderでも同じ処理を確認した。
Perryの経路は保存 `.ll` に `mod.i32.integer` と `mod.f64.fallback` のブロックがある。
この入力の正の小さい整数には、整数剰余の経路が適する。

これはprimesの速度差と整合する有力な要因だが、生成IR/Cの観察であり、
剰余だけを入れ替えた対照や全実行系の機械語プロファイルは今回取得していない。
総時間の差を全て剰余へ帰属しない。

OseoとPorfforにはさらに、C最適化の前に見える処理の違いがある。
PorfforのcountPrimesは `f64 candidate` / `f64 divisor` と直接のwhile・乗算で、
builtinの本体も同じtranslation unitにある。
Oseoは反復ごとのセル作成・環境アクセス・多くの汎用runtime呼出しを残し、
runtimeは別archive。その呼出しの本体は通常のアプリケーションC最適化からは見えない。
O2を足すだけで、意味論的なセルの不要性や汎用呼出しの数値特殊化が自動的に解決するわけではない。

オブジェクト更新では、Porfforにも20-byte entryの線形検索とdelete時のmemmoveの経路がある。
今回のchurnはほとんどの反復で0→1→0キーとなり、この表現には好条件。
以前の[キー数を増やした対照](object-shapes-benchmark.md#5-porffor-shape変化に強いより小さい表が安い)
では、この優位を多くのキーを保持する場合へ一般化できなかった。
Perryも今回stable 36msに対しchurn 998msと大きく変わる。
動的操作の実装は、数値ループのnative化とは別の評価軸である。
jsonにはparse/stringify・文字列・配列・プロパティ処理が含まれ、今回の時間だけで主因を1つに確定しない。

## 保存物と再現

- Porffor: 各対象の `measured/out.c`。
- Static Hermes: `measured/out.c` / `out.ir`。
- Perry: `measured/intermediates/tmp/perry_llvm_scratch_*/perry_llvm_*.ll`。
- scriptc: LLVM条件は `measured/<workload>.ll` / `.ir.json`、C条件は `.c` / `.ir.json`。
- Oseo/Node: 前回の同じ実行物。今回のconfig/resultは比較ディレクトリの新しいround-*に保存。

各ファイルの具体的なパス、ソース・バイナリhash、バージョン、全バッチ値はJSONに保存。
Porffor alpha 6 (`038f415`)、Perry 0.5.1520、scriptc 0.0.36、
Static Hermes revision `7508017ae267ecffe4c4df38656713034f35d9bf`、
Oseo revision `317b58bbe686219ed9b715473c91ee2e9b5c5817`。

```sh
# 前回のOseo studyの成果物を用意した状態で実行。各コマンドは直列。
mise exec -- node scripts/experiments/native-comparison.ts --phase compile
mise exec -- node scripts/experiments/native-comparison.ts --phase measure
mise exec -- node scripts/experiments/collect-native-comparison.ts
```

別ディレクトリには `--output build/my-native-comparison` を指定する。
`--targets scriptc-c,scriptc-ts` 等で一部の再コンパイル・再測定ができる。
今回のOseo O2/sanitizerなしは、通常条件の測定後に
`--phase measure --targets oseo-O2-no-sanitizers` で別に3ラウンド測定した。
新しいハーネスは型チェック成功、保存時に全36成功条件の3ラウンド・checksum・実行物hashを検証した。
