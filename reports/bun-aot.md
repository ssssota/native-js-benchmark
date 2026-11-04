# Bun AOT検証（2026-11-03）

BunのAOTを既存CLIへ追加し、通常のJIT実行ファイル化、型付きTS、`--trim`を比較した。今回のM1ではhelloのファイルサイズが同revisionのJIT版117.94 MiBからAOT版49.88 MiB、trim版23.47 MiBへ縮んだ。速度は処理依存で、型なしAOTは素数・JSON・キー削除で改善し、固定キー更新は遅くなった。型付き版も常に速いわけではない。

全40条件×3ラウンドのサンプル・バイナリSHA-256・元ソースSHA-256・explain診断は[bun-aot-results.json](bun-aot-results.json)、互換性検証とLinuxのサイズは[bun-aot-correctness.json](bun-aot-correctness.json)に保存した。過去の計測値は混ぜていない。

## 提供状況と固定した実行物

公式には[`bun compile`と`bun build --compile --aot`](https://bun.sh/docs/compiler/aot)が説明され、[導入PR #45631](https://github.com/oven-sh/bun/pull/45631)はmainへマージ済みである。ただし、今回取得した**安定版1.4.4（`38afee6c8`）ではAOTを使えなかった**。

- `bun compile src/hello.js`は`Script not found "compile"`。
- `bun build --help`に`--aot`がない。
- `bun build --compile --aot ...`は成功するが、未知のフラグが無視されて通常のJIT実行物になる。終了コード0だけではAOTの証拠にならない。

AOTの検証には公式npm配布の`1.4.4-canary.20261102.1`、full revision **`271b65ec608a50eca96a894c6bbff1e65849d920`**を使った。npmの固定URLとSHA-512 integrityを[bun-canary-config.json](../scripts/bun-canary-config.json)に保存した。毎日入れ替わるGitHubの`canary` URLへの依存は避けた。

このnpm配布物の`bun --version`表示も`1.4.4`だった。package version・自己申告version・実際のrevisionを分けて記録し、helpにAOTフラグがあること、full revision、コンパイラのexplain出力を確認している。安定版へのフォールバックは行わない。

| 構成名                    | コンパイラ  | 入力・オプション                         |
| ------------------------- | ----------- | ---------------------------------------- |
| `bun-cache-off/on`        | 安定版1.4.4 | 従来の実行ファイル化、bytecodeなし／あり |
| `bun-canary-cache-off/on` | 固定canary  | 同revisionのJIT対照、bytecodeなし／あり  |
| `bun-aot`                 | 固定canary  | `.js`、AOT                               |
| `bun-aot-typescript`      | 固定canary  | 既存の`.ts`、AOT                         |
| `bun-aot-trim`            | 固定canary  | `.js`、AOT＋`--trim`                     |
| `bun-aot-typescript-trim` | 固定canary  | `.ts`、AOT＋`--trim`                     |

主な比較基準は同じcanaryのJIT対照である。安定版Bunのソース実行は参考値で、AOTとの差にはrevisionの違いも含む。

## コンパイル方式と保存物

Bunは型検査・プログラム全体の値解析を行い、JavaScriptCoreの最適化バックエンドで機械語を生成してBun runtimeと実行物にまとめる。今回のプログラムをCへ変換して外部Cコンパイラへ渡す方式ではなく、追加のC/LLVMツールチェーンは要求されない。ビルド時に見える型なしJSも機械語化され、型が合わない外部値には汎用の機械語経路がある。文字列からの`eval`などはinterpreterで動く例外である。[公式の内部説明](https://bun.sh/docs/compiler/internals)。

`--trim`は未使用のBun/Node APIを除去する実験的な機能。JIT版のbytecode cacheとは別の軸として比較した。[サイズの公式説明](https://bun.sh/docs/compiler/size)。

CLIは次の2種類を保存する。

- `out.aot-explain.log`：`--explain=json`の全stdout。ビルド進捗・build IDも混ざる。
- `out.aot-explain.json`：上記から抽出した診断JSON配列。通常のcompile出力しかない場合はビルドを失敗させる。

これはCやLLVM IRではなく、コンパイラの最適化診断である。実行物のSHA-256、canary package version、full revision、AOT/trimフラグはホストの`build.json`・計測結果に記録する。Docker計測にも対応するpin情報を記録する。

## バイナリサイズ

同じ`hello`を使ったファイルサイズ。1 MiB = 1,048,576 bytes。stripなどの追加加工は行っていない。

| 構成                           | macOS arm64 | Linux arm64 |
| ------------------------------ | ----------: | ----------: |
| 安定版JIT、bytecodeなし／あり  |   85.03 MiB |  104.17 MiB |
| canary JIT、bytecodeなし／あり |  117.94 MiB |  137.49 MiB |
| canary AOT、JS／TS             |   49.88 MiB |   66.68 MiB |
| canary AOT＋trim、JS／TS       |   23.47 MiB |   27.43 MiB |

Macでは、同revisionのJIT版に対してAOTが約57.7%、AOT＋trimが約80.1%小さい。今回のhelloではJS/TSのサイズは同じだった。コードが増えた場合の増加率を示す数字ではない。

Macでは`otool -L`、Linuxでは既存の`ldd`検査で、OS標準ライブラリだけへの依存を確認した。共有ライブラリの容量は表に含まない。MacではICUなどをOSから使うため、異なるOSの列を同じ配布条件とは扱わない。

## 速度

Apple M1、macOS Darwin 25.6.0、arm64、AC電源・バッテリー100%。ビルド・Docker動作確認・テストを終えてからホスト上で逐次計測した。第2ラウンドだけ順序を反転し、計3ラウンド。

helloはspawnから終了までを親の`hrtime`で測り、3起動のwarmup後に15起動を採用。その他は既存のプロセス内runnerを使い、2バッチのwarmup後に5バッチを採用した。バッチの反復数はpilotから約150 msを目標に選び、各ラウンドで固定した。表は**ラウンド中央値3個の中央値、ms/workload呼出し**。

| 対象                           | hello（process） | primes |   json | object-stable | object-churn |
| ------------------------------ | ---------------: | -----: | -----: | ------------: | -----------: |
| canary JIT、bytecodeなし       |           11.176 |  2.500 | 10.818 |         2.320 |       11.900 |
| canary JIT、bytecodeあり       |           11.318 |  2.520 | 10.545 |         2.320 |       12.200 |
| AOT JS                         |            9.666 |  2.140 |  9.750 |         3.316 |        4.500 |
| AOT TS                         |            9.900 |  2.093 | 11.364 |         1.293 |       15.400 |
| AOT JS＋trim                   |            9.185 |  2.133 |  9.538 |         3.289 |        4.500 |
| AOT TS＋trim                   |            9.477 |  2.093 | 11.364 |         1.287 |       15.500 |
| 安定版Bun 1.4.4 source（参考） |            6.598 |  2.600 | 11.200 |         2.318 |       11.800 |
| Node 26.10.0 source（参考）    |           30.633 |  4.033 | 16.750 |         5.320 |        9.429 |

型なしAOTは同canaryのbytecodeなしJITに対し、素数が約1.17倍、JSONが約1.11倍、churnが約2.64倍速い。一方、stableは約1.43倍の時間がかかる。型付きAOTは型なしAOTに対してstableが約2.56倍速いが、churnは約3.42倍の時間を要した。`--trim`による定常処理速度の大きな変化は見られなかった。

JS AOT churnのラウンド中央値は4.467–4.600 ms、TS AOT churnは15.100–16.000 msで、この逆転は3ラウンドとも見られた。一方、JIT bytecodeありのJSONは10.455–18.091 msとばらついた。小さな差を一般化せず、全サンプルと範囲はJSONで確認できる。

プロセス内の時計は既存の`Date.now()`で1 ms分解能。各workloadの初期化も呼出しごとに含み、JSONは1,000レコード×100回の変換を1呼出しとする。入力のコピー・コンパイル・計測用Node起動は計測対象外。helloはwarmup後の値であり、cold起動の比較ではない。Bun sourceが最速だったことも含め、AOTで起動が常に最速になるとは結論しない。

## 診断と型情報

primesはJS/TSとも診断にslow-path原因がなく、proven call siteが7。JSONはJSがtested 6 / free 3、TSがtested 4 / free 5だったが、TSが速い結果にはならなかった。

objectのJS版は`property-added`（stable）・`field-deleted`（churn）を原因として報告し、by-name access siteが4だった。既存TS版は`{ [key: string]: number }[]`というindex signatureを使い、by-nameが12、`not-a-plain-object`の診断が12件出た。入力は固定プロパティだけのclassを測るものではない。

これらは初期化も含む**静的なaccess site数**であり、実行頻度や時間配分ではない。stable/churnの速度差をこの件数だけで説明できない。今回C/LLVM IRやhotspot profileは取得しておらず、型によるloweringの違いがどの処理に何ms寄与したかまでは分解していない。診断全文は結果JSONの`aotExplain`に残した。

別の型境界probeでは、JSON由来の値を`{x: number; y: number}`へ渡して`x + y`を計算した。JIT/AOTとも`{x:2,y:4}`はnumberの`6`、`{x:"2",y:4}`はstringの`"24"`を返し、型宣言へ数値変換することはなかった。静的な`const value: number = "wrong"`は、AOTでTS2322・終了コード1、通常のJIT実行物化ではビルド成功だった。

## 動作確認

canary JIT対照2構成＋AOT4構成について、既存workloadを通常CLIでコンパイル・実行した。

- macOS arm64：54件成功。host backendで元々未対応のnpm-cli 6件はスキップ。
- Docker Linux arm64：全60件成功。hello・環境変数・素数・JSON・object 2種・fetch・file-cli・http-server・npm-cliを含む。
- HTTPサーバーはreadinessを待ち、`/`の200と`/missing`の404、応答本文を確認して終了。
- 配列中のオブジェクトの参照更新・キー削除の独立probeと、全40計測条件の期待値検査が成功。
- host/DockerともBun全8構成の標準`bench`でprimesを確認。DockerのAOT TS＋trimではasync fetchの結果とHTTP要求回数も一致。
- 型検査と47テストが成功。Linux x64 CIにも新6構成を追加したが、変更後のリモートCIはまだ実行していない。

ホスト検証中にPATH先頭の別Bunがmise版を上書きする問題も見つかった。通常Bunのビルド・ソース実行・version取得は`mise which bun`の絶対パスへ統一し、今回のBun source計測は1.4.4で準備し直してから実行した。

## 再実行

```sh
mise install
mise exec -- pnpm cli build --backend host --tool bun-aot
mise exec -- pnpm cli compile --backend host --tool bun-aot-trim --workload hello
mise exec -- pnpm cli run-binary --backend host --tool bun-aot-trim --workload hello
mise exec -- pnpm cli sizes --backend host --tool bun --workload hello

# 同revisionのJITとの比較
mise exec -- pnpm cli bench --backend host --tool bun-canary-cache-off --workload primes --mode in-process --iterations 50
mise exec -- pnpm cli bench --backend host --tool bun-aot --workload primes --mode in-process --iterations 50
mise exec -- pnpm cli bench --backend host --tool bun-aot-typescript --workload object-churn --mode in-process --iterations 10
mise exec -- pnpm cli bench-results --backend host --tool bun --workload primes --mode in-process

# Docker。同じCPU/OS上でビルドする（Bun AOTはクロスコンパイル非対応）
mise exec -- pnpm cli build --tool bun
mise exec -- pnpm cli run --tool bun --workload hello
mise exec -- pnpm cli compile --tool bun-aot --workload npm-cli
mise exec -- pnpm cli run-binary --tool bun-aot --workload npm-cli

# 全workloadの動作確認
mise exec -- node scripts/experiments/bun-aot-smoke.ts --backend host
mise exec -- node scripts/experiments/bun-aot-smoke.ts --backend docker

# 今回の40条件。全ビルドが完了してから計測する
mise exec -- node scripts/experiments/cross-language.ts --suite bun-aot --phase compile
mise exec -- node scripts/experiments/cross-language.ts --suite bun-aot --phase measure --snapshot reports/bun-aot-results.json
```

配布archive（実行物を含むnpm package）は`build/tools/bun-canary-1.4.4-canary.20261102.1/source.tgz`、生成物・ログ・probeは`build/bun-aot-2026-11-03/`に保持した。通常CLIの成果物は従来どおり`build/host-darwin-arm64/`・`build/docker/`以下。保存済みarchiveを使う場合は`BUN_CANARY_ARCHIVE=/path/to/source.tgz`を指定でき、同じintegrityとrevisionを検証する。
