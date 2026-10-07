# ツール更新前後の性能（2026-10-05）

Porfforは素数・JSONがほぼ横ばいで、固定キーのオブジェクト更新が5.6%、キーの追加・削除が3.0%短縮した。scriptcはJSONが74.5%増加した。NodeはJSONが23.2%短縮した一方、素数は4.0%、固定キー更新は6.5%増加した。Static HermesとDenoには今回の入力で大きな変化がない。

[保存データ](tool-update-performance-results.json)、[更新内容](tool-update-2026-10-05.md)。旧版も更新版と同じホストで測り直した。前のレポートの値を更新前の基準として流用していない。

## 条件とバージョン

Apple M1 / macOS arm64 / Darwin 25.6.0。更新前後の全5ラウンドがAC電源で、AC側のlowpowermodeは0。以前の調査はバッテリー電源・lowpowermode 1だったため、その時間との減少率をバージョン更新の効果と解釈できない。

| 対象              | 旧版      | 新版      |
| ----------------- | --------- | --------- |
| Porffor JS        | alpha-6   | alpha-15  |
| scriptc JS / LLVM | 0.0.36    | 0.2.3     |
| Static Hermes JS  | 2026.9.20 | 2026.10.1 |
| Node source       | 24.21.0   | 26.10.0   |
| Deno source / V8  | 2.9.6     | 2.9.7     |

Static Hermesのrevisionは`7508017ae267ecffe4c4df38656713034f35d9bf` → `6e2181b288b0306d8bd1988d38d32aa879b745d5`。Porfforは`038f415` → `72d048d`。NodeのV8は`13.6.233.17-node.53` → `14.6.202.34-node.34`。DenoのV8は両版とも`15.0.245.2-rusty`。DenoのQuickJS経路はそれぞれのDenoで新規にコンパイルした実行ファイルを測定した。

同じ入力・同じ呼出し数を旧版と新版のペアに使い、5ラウンドを直列実行。各ラウンドで旧／新の順を交代し、偶数ラウンドではケース順も逆転した。各条件は新しいプロセスで2バッチwarmup、5バッチ測定。pilotで速い側のバッチが約150msになる共通呼出し数を選び、500回で上限を設けた。表は5プロセスの中央値の中央値、1 workload呼出しあたりのms。各呼出しは初期化を含む。

素数は100,000まで、JSONは1,000レコード×100回、objectは256個・8キー・200,000更新。時計は`Date.now()`のバッチあたり1ms単位。全測定のchecksum・入力hash・実行物hashを検証した。コンパイルは各ツールの通常のrelease設定で、ツール間の最適化・sanitizer設定は統一していない。旧・新のC/IR出力も保存した。

CPU周波数・温度や他のホストプロセスは固定していない。ペア差の範囲は5回で観測した最小～最大で、信頼区間ではない。数%の変化は今回の入力で繰り返した傾向として読む。

## 定常処理の差

変化率は`(新版 / 旧版 - 1) × 100`。負は時間短縮、正は時間増加。

| 対象                   | workload      | 呼出し/バッチ |  旧 ms |  新 ms |   変化 |  ペア差の範囲 |
| ---------------------- | ------------- | ------------: | -----: | -----: | -----: | ------------: |
| Porffor JS             | primes        |             3 |  55.00 |  54.67 |  -0.6% |   -1.2～+0.0% |
| Porffor JS             | json          |             2 | 112.50 | 111.50 |  -0.9% |   -0.9～+0.0% |
| Porffor JS             | object-stable |            17 |   8.41 |   7.94 |  -5.6% |   -7.6～-5.6% |
| Porffor JS             | object-churn  |            15 |   9.00 |   8.73 |  -3.0% |   -3.0～-2.2% |
| scriptc JS / LLVM      | primes        |             3 |  55.00 |  57.00 |  +3.6% |   +3.6～+4.3% |
| scriptc JS / LLVM      | json          |             3 |  52.33 |  91.33 | +74.5% | +73.4～+78.2% |
| Static Hermes JS       | primes        |            38 |   3.84 |   3.84 |  +0.0% |   -0.7～+0.0% |
| Static Hermes JS       | json          |             6 |  29.17 |  29.00 |  -0.6% |   -0.6～+0.0% |
| Static Hermes JS       | object-stable |             9 |  16.00 |  16.00 |  +0.0% |   -0.7～+0.0% |
| Static Hermes JS       | object-churn  |             6 |  27.67 |  27.50 |  -0.6% |   -3.5～+1.2% |
| scriptc TS / LLVM      | primes        |             3 |  54.67 |  54.67 |  +0.0% |   -0.6～+0.0% |
| Static Hermes Flow     | primes        |            30 |   3.80 |   3.80 |  +0.0% |   +0.0～+0.0% |
| Node source            | primes        |            38 |   3.97 |   4.13 |  +4.0% |   +1.9～+4.0% |
| Node source            | json          |             9 |  21.56 |  16.56 | -23.2% | -23.6～-22.7% |
| Node source            | object-stable |            25 |   4.96 |   5.28 |  +6.5% |   +5.6～+6.5% |
| Node source            | object-churn  |            14 |   9.36 |   9.36 |  +0.0% |   -0.8～+1.5% |
| Deno source / V8       | primes        |            38 |   4.92 |   4.89 |  -0.5% |   -1.1～+0.5% |
| Deno source / V8       | json          |             8 |  18.62 |  18.75 |  +0.7% |   +0.7～+2.0% |
| Deno source / V8       | object-stable |            25 |   5.28 |   5.28 |  +0.0% |   +0.0～+0.7% |
| Deno source / V8       | object-churn  |            14 |   9.71 |   9.71 |  +0.0% |   -0.7～+0.0% |
| Deno compile / QuickJS | primes        |             3 |  65.00 |  65.00 |  +0.0% |   -0.5～+0.5% |
| Deno compile / QuickJS | json          |             2 |  84.00 |  84.00 |  +0.0% |   +0.0～+0.6% |
| Deno compile / QuickJS | object-stable |             4 |  39.00 |  38.75 |  -0.6% |   -0.6～+1.9% |
| Deno compile / QuickJS | object-churn  |             4 |  40.00 |  39.75 |  -0.6% |   -0.6～+0.0% |

scriptc JSの両objectケースは、配列内objectの参照共有probeが旧版・新版とも0（期待9）だったため除外した。workload全体のchecksumが一致するだけでは、この参照更新の意味論を保証できない。TS JSON等の未対応条件は[更新時の検証表](tool-update-2026-10-05.md#検証)に記録した。

## helloの起動込み

各ラウンド3回warmup後、15回のspawn-to-exitを親の`hrtime`で計測。以下は5ラウンドの中央値の中央値。処理・出力・親からのプロセス起動を含み、定常処理の値とは別の測定。

| 対象                   | 旧 ms | 新 ms |  変化 | ペア差の範囲 |
| ---------------------- | ----: | ----: | ----: | -----------: |
| Porffor JS             |  1.71 |  1.68 | -1.3% |  -3.3～+1.0% |
| scriptc JS / LLVM      |  1.75 |  1.71 | -2.6% |  -3.1～+1.8% |
| Static Hermes JS       |  5.90 |  5.97 | +1.1% | -1.9～+14.9% |
| Node source            | 31.29 | 30.78 | -1.6% |  -4.4～-1.3% |
| Deno source / V8       | 11.33 | 11.26 | -0.6% |  -0.9～+0.0% |
| Deno compile / QuickJS | 15.63 | 15.60 | -0.1% |  -1.1～+0.3% |

helloはラウンド間の揺れがある。例えばStatic Hermesのペア差は−1.9～+14.9%で、表の+1.1%だけから起動が遅くなったとは判断しない。

## 現在の絶対性能と未更新の対照

Perry 0.5.1520・Oseo revision `317b58bbe686219ed9b715473c91ee2e9b5c5817`は更新がない。保存済みの同一バイナリを、旧／新ペアの測定後にAC電源で3ラウンド測り直した。warmup・サンプル数・元のworkloadは同じで、呼出し数は保存済みwrapperの値を維持した。バイナリと入力のhashも旧記録に一致した。これらは現在の位置を見る対照で、バージョン更新の効果を測った値ではない。

| 実行系                                | primes ms |  json ms | object-stable ms | object-churn ms |
| ------------------------------------- | --------: | -------: | ---------------: | --------------: |
| Node source                           |      4.13 |    16.56 |             5.28 |            9.36 |
| Deno source / V8                      |      4.89 |    18.75 |             5.28 |            9.71 |
| Static Hermes JS                      |      3.84 |    29.00 |            16.00 |           27.50 |
| Porffor JS                            |     54.67 |   111.50 |             7.94 |            8.73 |
| scriptc JS / LLVM                     |     57.00 |    91.33 |                — |               — |
| Deno compile / QuickJS                |     65.00 |    84.00 |            38.75 |           39.75 |
| Perry JS（据え置き）                  |      6.62 |   112.00 |            22.33 |          627.00 |
| Oseo JS 標準（据え置き）              |    886.00 | 2,443.00 |           814.00 |          785.00 |
| Oseo 生成CもO2・sanitizerなし（対照） |    407.00 |        — |                — |          341.00 |

参考のhelloはPerry 4.02ms、Oseo 3.30ms。Oseo標準は生成Cに最適化指定なし、ランタイムO2、ASan/UBSanあり。O2/sanitizerなしは対照実験で、通常の設定は変更していない。

Oseo標準の素数はPorfforの16.2倍、JSONは21.9倍の時間がかかる。生成CにもO2を付けsanitizerを外した素数でも7.4倍。今回の電源条件で再測定しても、Oseoが遅いという傾向は変わらない。Oseo Cに残るenvironment/cell・汎用演算・status検査と、数値ローカルを直接下ろすPorffor等の違いは[前のC/IR調査](native-comparison.md#性能差を説明する具体例-primesの剰余)を参照。

## C・IRに見える差

### Porffor: 数値ループは同じ、object経路は変更

旧・新の`countPrimes`を保存Cから抽出し、関数名だけを正規化すると本文が完全一致した。`candidate`・`divisor`・`count`は`f64`で、剰余は引き続き`fmod(candidate, divisor)`。今回の更新で整数剰余の経路になったわけではなく、素数が55.00 → 54.67msでほぼ横ばいだったことと対応する。

確認箇所は`build/tool-update-performance-2026-10-05/porffor/primes/{old,new}/measured/out.c`、旧4377行・新7545行の関数。抽出した本文も保存JSONの`diagnostics.porfforPrimes`に含めた。

固定キー更新のCでは、旧`porf_call_dynamic`から新`porf_call1`への変更、`object_get`に渡すキーの経路の変更などがある。旧Cには呼出し側の`ToPropertyKey`が現れ、新Cではキーを直接渡す。変換が別のhelperへ移った可能性もあるため、これだけで変換処理の消滅や5.6%短縮の原因を確定しない。builtin・ランタイムも変更されている。

### scriptc: JSONの集計が数値専用から汎用値へ

| `benchmarkWorkload`内         | 0.0.36             | 0.2.3                         |
| ----------------------------- | ------------------ | ----------------------------- |
| `total`の格納                 | `alloca double`    | `alloca ptr`（汎用値）        |
| `total += record.amount`      | `fadd double`      | `scr_dyn_add`                 |
| parsed配列のループ比較        | `fcmp olt double`  | `scr_dyn_compare`             |
| JSON文字列化                  | `scr_dyn_format_j` | `scr_json_stringify_replacer` |
| retain/releaseの静的call site | 10 / 118           | 14 / 139                      |

LLVMファイルは`scriptc/json/{old,new}/measured/json.ll`。`total`は旧829行・新834行、加算は旧1106行・新1121行、配列の比較は旧1006行・新1070行。retain/release数はエラー時のcleanupを含む静的call site数であり、動的な確保回数や実行回数ではない。IRは後段の最適化前なので、各call siteが最終コードに残るかも別の問題。

74.5%増加の原因候補として汎用加算・比較・値変換・文字列化経路の変更があるが、それぞれを入れ替えた対照や実行時プロファイルは取っていない。時間差を加算だけへ帰属しない。

小さい意味論検査も実行した。

```js
const record = JSON.parse('{"amount":"7"}');
let total = 0;
total += record.amount;
console.log(JSON.stringify(total));
```

Nodeと新版scriptcは`"07"`を出力し、旧版は`Uncaught TypeError: expected number at $, got string`で終了した。この入力では新版がJavaScriptの文字列加算を扱う。旧版が速い数値入力の測定値だけから、新版の汎用化を単純な最適化の退行と判断できない。一方、測ったJSON workloadのamountは常に数値で、旧・新とも期待checksumに一致しているため、その入力における74.5%増加自体は観測事実。probeのソース・実行コマンド・結果は保存JSONに含めた。

素数のJS版でも、外側の比較が旧版の数値変換＋`fcmp`から新版の数値boxing＋`scr_dyn_compare`へ変わった。剰余は旧`fmod`呼出し、新`frem double`で、浮動小数点のまま。TS版の数値limitには直接の`fcmp ole double`が残る。JSは+3.6%、TSは0.0%という傾向に対応するが、比較だけの因果効果は切り分けていない。

### Static Hermes・Node・Deno

Static Hermesの素数Cは両版で同じ`_sh_mod_double`呼出しが残り、素数・JSON・固定キー更新はほぼ横ばい。Flowの素数も3.80 → 3.80msだった。

NodeのJSON改善と他workloadの小さい増加は、Node/V8をまとめて更新した際の観測値。V8のどの最適化が原因かは今回の測定から判断しない。DenoのV8 versionは変わらず、V8 sourceとQuickJS compileの両経路がほぼ横ばいだった。

## 保存物と再測定

全30ペアの5ラウンド（300条件）と、据え置きツール12ケースの3ラウンド（36条件）を保存・検証した。scriptc JS objectの2ケースは測定前に意味論検査で除外。各条件の元ソース・wrapper・全サンプル・実行コマンド・実バージョン・入力／実行物hash・C/IRのパスとhashをJSONに含めた。`compileMs`はC/IR診断の出力も含む1回の準備時間で、コンパイル速度のベンチマークには使っていない。

ローカルの保存先は`build/tool-update-performance-2026-10-05/`。Porffor/Static HermesのCは各`measured/out.c`、Hermes IRは`out.ir`、scriptcは`<workload>.ll`・`<workload>.ir.json`。旧scriptcのCバックエンドとの速度比較は今回実施していない（新版はLLVMのみ）。

再測定には旧版のmiseインストールと、`build/tool-update-2026-10-05/packages/scriptc-old/node_modules/scriptc/dist/bootstrap.js`（scriptc 0.0.36）が必要。新版本体は現workspaceのpinを使う。旧scriptcは独立ディレクトリに固定版をnpm installした。参考ツールの測定には、前のnative comparisonで保存したPerry/Oseoバイナリとresults.jsonが必要。

```sh
# 個々のコマンドは直列に実行する。
mise exec -- node scripts/experiments/tool-update-performance.ts --phase compile
mise exec -- node scripts/experiments/tool-update-performance.ts --phase measure
mise exec -- node scripts/experiments/tool-update-performance-reference.ts
mise exec -- node scripts/experiments/collect-tool-update-performance.ts
```

旧／新のペアは`--output build/my-tool-update`で保存先を変更できる。reference/collectorの保存先指定は位置引数。collectorは30ペア・5ラウンド・checksum・入力／実行物hash・実行時version・AC電源状態と、12参考ケース・3ラウンドのバイナリ／入力hashを確認してからレポート用JSONを保存する。意味論probeは追加診断であり、上記の通常の再測定には含まれない。

保存時に336測定条件の生サンプルから中央値と全ペアの比率を再計算し、集計値との一致を確認した。追加スクリプトの型検査、既存40件のテスト、変更ファイルのformat検査も成功した。
