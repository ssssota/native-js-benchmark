# Ruby / Python AOTの検証（2026-10-07）

Spinel・LythonをAOTツール、CRuby・CPythonをソース実行の比較基準として追加した。macOS arm64とDocker Linux arm64で、hello・primes・json・object-stable・object-churnの通常実行と計測を確認した。

今回のM1での計測では、素数はSpinelがCRubyの約39.8倍、LythonがCPythonの約17.7倍速い。一方、JSONはSpinelがCRubyの約1.77倍、LythonがCPythonの約7.73倍の時間を要した。Hash/dict操作も結果が異なり、AOTという分類だけでは速度を予測できない。

全サンプル、実際のversion表示、ソース・実行物・C/IRのSHA-256、反復数、依存ライブラリは[cross-language-results.json](cross-language-results.json)に保存した。過去のJS計測値は混ぜず、Node・Porffor・Static Hermesも今回再計測した。

## 方式と固定バージョン

| ツール        | 今回の固定対象                                                    | コンパイル／実行方式                                                             |
| ------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Spinel        | release archive `2026.09.12`、SHA-256は設定ファイルに固定         | Ruby → Prism AST → 全体の型推論 → C → システムcc `-O2`＋Spinel runtime           |
| Lython        | `98aa88b92786538ea57eea48ee65a4142f211e71`、LLVM/MLIR 23.1.2      | Python → 専用のMLIR表現・型契約・lowering → LLVM → ネイティブ実行物＋独自runtime |
| CRuby         | 4.0.7                                                             | Ruby VMによる実行。`--disable-gems --disable-yjit`                               |
| CPython       | 3.14.8                                                            | Python interpreter。`-I -B`。今回のホストでGIL有効、実験的JITは利用可能だが無効  |
| Node          | 26.10.0                                                           | 通常のソース実行、V8 JITの既定設定                                               |
| Porffor       | alpha 15、`72d048d`                                               | JS → Porfforの表現 → 生成C → ネイティブ実行物                                    |
| Static Hermes | CLI v2026.10.1、Hermes `6e2181b288b0306d8bd1988d38d32aa879b745d5` | 型なしJS、`shermes -O -static-link`、Hermes VMを静的リンク                       |

Spinelはコンパイラ自体もCの単一実行物で、実行時にCRubyを使わない。型推論で分かった数値・呼び出しをCへ落とし、必要な組み込み処理とGCを自前のruntimeで扱う。動的evalや一部のmetaprogrammingなどには制約がある。[公式の方式説明](https://github.com/matz/spinel#how-it-works)、[対応範囲](https://github.com/matz/spinel/blob/2026.09.12/docs/limitations.md)。

取得したSpinelのrelease archiveはSHA-256を確認済みだが、実際の`--version`は`spinel e2ae5d835bc2 (unreleased) [Apple clang version 17.0.0 ...]`だった。release名とCLIの自己申告は別々に記録し、CLIが`2026.09.12`と表示したとは扱っていない。

LythonはCPython 3.14由来のPEG解析器・ASDLを使うが、CPython interpreter本体を組み込む方式ではない。解析器を独自ABIへ移植し、独自の型契約とruntimeを通してLLVMへ落とす。通常の`lyc input.py -o out`を使い、READMEの例にある`jit`は今回使わない。[解析器の移植方針](https://github.com/t3tra-dev/lython/blob/98aa88b92786538ea57eea48ee65a4142f211e71/src/lython/parser/CPYTHON_PATCHES.md)、[AOT・IR出力の実装](https://github.com/t3tra-dev/lython/blob/98aa88b92786538ea57eea48ee65a4142f211e71/tools/CLI.cpp)。

LythonのJSONは、CPythonのpure Python実装を基にした専用ライブラリで、`_json`のC acceleratorを使わない。さらに、再帰的な動的unionの代わりに`JSONValue`というタグ付きツリーを使うため、通常の`json.dumps(dict)`をそのまま渡すことはできない。[固定revisionのJSON API・設計説明](https://github.com/t3tra-dev/lython/blob/98aa88b92786538ea57eea48ee65a4142f211e71/src/lython/runtime/lib/json.py)。

## 類似workloadの条件

| workload      | 揃えた処理・期待値                                                      | 表現の違い                                           |
| ------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| hello         | `hello`を1回出力                                                        | 各言語の標準出力                                     |
| primes        | 100,000まで、同じ試し割り、`9592`                                       | Ruby/Pythonは整数、JSはNumber                        |
| json          | 1,000レコード、100回の解析・絞り込み・集計・大文字化・再生成、`1491500` | Pythonはcompact separators。Lythonだけ専用JSONツリー |
| object-stable | 256個、8文字列キー、20万更新、ゼロへ戻して読む、`102387360`             | Ruby Hash / Python dict / JS object                  |
| object-churn  | 同じ選択・更新後にキーを削除して欠落を読む、`102387360`                 | 各言語の削除操作                                     |

Rubyの5本はSpinelとCRubyで共用する。Pythonのhello・primes・objectはLythonとCPythonで共用し、JSONは[CPython用](../src/json.cpython.py)と[Lython用](../src/json.lython.py)を分けた。Lython版は`arr_of` / `obj_of`で同じデータを構築し、型別アクセサーで値を取り出す。`json.py`という名前は標準ライブラリを隠してimport cycleを起こすため避けている。

配列内のHash/dict/objectを取り出して変更したとき、元の配列からも変更・削除が見えることを別の小さなprobeで確認した。7対象すべて`9`・`-1`を出力した。計測runnerでも期待値に一致しない結果は拒否する。

object比較はキー付きコンテナの類似操作であり、Ruby/PythonでJSのhidden classを再現するものではない。整数表現、例外・overflow処理、JSON parserやデータ構造の違いも含む。特に同じ言語のAOT対interpreterを基準に読み、言語をまたぐ順位をコンパイラだけの優劣と解釈しない。

Pythonの欠落検出は`key not in obj or obj[key] == 0`で、stableではmembership確認と値の読出しを行う。Ruby/JSは値を1回読み出して欠落・ゼロを判定するため、この部分の検索回数も完全には一致しない。

## 計測結果

Apple M1、macOS Darwin 25.6.0、arm64。バッテリー駆動96→95%。コンパイラ・Dockerビルド・動作テストを終えてから、ホスト上で順番に3ラウンドを実行し、第2ラウンドだけ対象順を反転した。Linuxの動作確認時の数値はこの表に含めない。

helloは親プロセスの`hrtime`でspawnから終了までを計測し、3回のwarmup後に15回。残りは各プロセス内で2バッチのwarmup後に5バッチ。表は**各ラウンドの中央値3個の中央値、ms/workload呼出し**。JSONの1呼出しには100回の変換を含む。

| 対象          | hello（process） |  primes |    json | object-stable | object-churn |
| ------------- | ---------------: | ------: | ------: | ------------: | -----------: |
| Spinel        |            2.984 |   4.176 | 128.619 |        17.562 |       12.067 |
| CRuby         |           13.951 | 165.993 |  72.565 |        61.228 |       56.218 |
| Lython        |            2.940 |   8.492 | 732.524 |        51.870 |       45.875 |
| CPython       |           20.519 | 150.175 |  94.772 |        46.714 |       43.846 |
| Node source   |           47.662 |   6.529 |  26.800 |         8.538 |       15.250 |
| Porffor       |            2.564 |  88.000 | 180.000 |        12.667 |       14.143 |
| Static Hermes |            8.812 |   6.200 |  47.000 |        25.800 |       44.250 |

| AOT / 同言語baseline     |  hello |  primes |   json | object-stable | object-churn |
| ------------------------ | -----: | ------: | -----: | ------------: | -----------: |
| CRuby時間 ÷ Spinel時間   | 4.68倍 | 39.75倍 | 0.56倍 |        3.49倍 |       4.66倍 |
| CPython時間 ÷ Lython時間 | 6.98倍 | 17.68倍 | 0.13倍 |        0.90倍 |       0.96倍 |

この比率は1より大きいとAOTが速い。Spinelは数値ループとHash操作で明確に改善するが、JSONで逆転する。Lythonは素数で改善し、dictのstableは約11%、churnは約5%長くかかる。JSONは専用ライブラリとツリー表現を含むため、同じJSONライブラリをAOT化したときの比較ではない。

Spinel primesのラウンド中央値は4.165–4.188 ms、Lython primesは8.488–8.837 ms、Lython JSONは731.777–733.250 msだった。Static Hermes object-stableは25.800–47.000 msと変動が大きいため、細かい順位判断には使いにくい。全範囲とバッチごとの値はJSONに残した。

反復数はpilotから約150 ms/batchを狙って対象ごとに選び、各ラウンドでは固定した。Rubyは`Process.clock_gettime(CLOCK_MONOTONIC)`、Pythonは`time.perf_counter()`、JSは`Date.now()`。JSの1 ms分解能による量子化が含まれる。ソース・実行物は計測前に一時領域へコピーし、コピー時間やコンパイル時間は除外した。初期化・コンテナ生成は各workload呼出しに含む。

helloの表はwarmup後の起動時間である。新しくコピーしたAOT実行物の最初の起動には数百msのサンプルもあり、これらはwarmupとして集計対象外だがJSONには保持した。cold起動の改善を示す表ではない。

## 生成C / LLVM IRで確認した点

生成物は`build/cross-language-2026-10-07/study/<workload>/<target>/measured/`、helloは`plain/`にある。通常CLIの出力は従来どおり`build/host-darwin-arm64/`または`build/docker/`以下。

Spinel primesのCは`sp_int`を使い、剰余を`sp_imod(candidate, divisor)`へ落とす。runtimeの`sp_int`はこの環境で64 bitの`intptr_t`、剰余は整数演算で、加算・乗算にはoverflow確認のhelperがある。CRubyの命令実行・動的な数値メソッド呼び出しを介さずにループを実行する形を確認できた。

Lython primesのIRには`count_primes__lyrt_prim_i64`、`srem i64`、整数overflowの確認がある。`benchmark_workload`からこのspecializationを呼び、成功フラグを確認して結果をPython整数表現へ戻し、失敗時に通常の整数経路へ進む。Python整数を無条件にmachine integerへ置き換える方式とは異なる。

Porffor primesのCでは`fmod(candidate, divisor)`が残る。Spinel/Lythonと同じC/LLVM最適化基盤を使えるとしても、ここで処理している数値表現が違う。今回のPorffor 88 ms対Spinel 4.176 msを、「生成Cという方式の速度差」だけで説明することはできない。

Spinel objectのCでは`sp_RbVal`と`sp_poly_set_str` / `sp_poly_get_str`、churnでは`sp_poly_delete_key`が残る。Lython objectのIRでも`LyDict_SetItemBox` / `LyDict_DelItemBox`と参照解放が残る。コンパイルしてもハッシュ検索・box・参照管理などのruntime処理は消えないことが分かる。

Lythonの保存する`out.ll`は`--emit-llvm`によるruntimeリンク後のIRであり、通常の非sanitizer経路では実行物の最終LLVM最適化より前の出力である。型のloweringや呼び出し先の確認には使えるが、残った命令数をそのまま最終実行コストとは扱わない。個別helperやJSON処理のhotspotをプロファイルしていないため、速度差への寄与率までは分解していない。

hello実行物のファイルサイズはSpinel 186,800 bytes、Lython 92,128 bytesだった。今回のホスト生成物は`otool -L`でOS標準ライブラリだけへの依存を確認した。ソース実行baselineのruntime・標準ライブラリ総容量とは別の指標である。

## 再実行

```sh
mise install
# macOSでLythonをビルドする前にLLVM/MLIR 23を用意する
brew install llvm
# 別のprefixなら LYTHON_LLVM_PREFIX=/path/to/llvm23

mise exec -- pnpm cli build --backend host --tool spinel
mise exec -- pnpm cli build --backend host --tool lython
mise exec -- pnpm cli compile --backend host --tool spinel --workload primes
mise exec -- pnpm cli run-binary --backend host --tool spinel --workload primes
mise exec -- pnpm cli run --backend host --tool lython --workload json

mise exec -- pnpm cli bench --backend host --tool spinel --workload primes --mode in-process --iterations 12
mise exec -- pnpm cli bench --backend host --tool cruby --workload primes --mode in-process --iterations 1
mise exec -- pnpm cli bench --backend host --tool lython --workload primes --mode in-process --iterations 7
mise exec -- pnpm cli bench --backend host --tool cpython --workload primes --mode in-process --iterations 1
mise exec -- pnpm cli bench-results --backend host --workload primes --mode in-process

# Dockerも同じCLI。backend省略時はDocker
mise exec -- pnpm cli run --tool lython --workload json
mise exec -- pnpm cli bench --tool cpython-source --workload json --mode in-process --iterations 1

# 今回の7対象を別artifact treeで比較する実験スクリプト
mise exec -- node scripts/experiments/cross-language.ts --phase compile
# 全ビルド完了後、他の重い処理を止めてから計測
mise exec -- node scripts/experiments/cross-language.ts --phase measure --snapshot reports/cross-language-results.json
```

Spinel/Lythonのソースは`build/tools/spinel-2026.09.12/`・`build/tools/lython-98aa88b92786538ea57eea48ee65a4142f211e71/`に置く。取得URL・SHA-256・LLVM majorは[dynamic-aot-config.json](../scripts/dynamic-aot-config.json)に固定した。LythonのLLVM apt repositoryはmajor 23のsuiteを指定し、mainのmajor更新を追わない。

今回のローカル検証は型検査、44テスト、新4ツール×5workloadのDocker通常実行・計測、ホスト上の7対象×5workload×3ラウンドが成功した。Dockerの共通計測イメージでも両interpreterと両AOT実行物を実行できる。GitHub Actionsには18バイナリ構成＋2 source baselineのジョブを追加したが、変更後のLinux x64 CIはまだ実行していない。

ビルド・動作確認・測定ログは`build/cross-language-2026-10-07/`に保持した。未移植のfile-cli・fetch-json・http-server・npm-cli・node-processは、新4ツールで明示的に拒否する。
