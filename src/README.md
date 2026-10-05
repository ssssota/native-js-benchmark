# ワークロード

コマンドの使い方は[ルートの README](../README.md)を参照してください。

| 名前 | 処理 | 期待する結果 |
| --- | --- | --- |
| `hello` | ログを1回出力 | `hello` |
| `node-process` | `node:process` を import して環境変数を出力 | `process.env.TEST` の値 |
| `object-stable` | 固定キーの値を更新・読み出し・ゼロに戻す | `102387360` |
| `object-churn` | キーを追加・読み出し・削除する | `102387360` |
| `primes` | 100,000 以下の素数を数える | `9592` |
| `json` | JSON の生成・解析・加工・再生成 | `1491500` |
| `fetch-json` | ローカルHTTP取得・JSON解析・加工 | `14915` |
| `file-cli` | ファイルの行数・単語数を数える | 付属データで `{"lines":2,"words":6}` |
| `http-server` | HTTP サーバーを起動 | `GET /` に `hello` を返す |
| `npm-cli` | lodash-es で文字列を kebab-case に変換 | 引数なしで `hello-native-java-script` |

```sh
# リポジトリのルートで実行
TEST=compatibility pnpm cli run --backend host --tool node-source --workload node-process
pnpm cli run --workload file-cli
pnpm cli run --workload npm-cli -- 'Hello World'
pnpm cli run --workload http-server --port 3000
```

プログラムへの引数は `--` の後に渡します。`npm-cli` の依存はworkspaceのcatalogで管理し、Docker実行前に `pnpm deploy` で独立配置します。
HTTP は localhost に公開し、Ctrl-C で停止します。`GET /` 以外は404です。

各ワークロードには標準の `.js` に加えて、Perry・scriptc・Oseo向けの `.ts` とStatic Hermes向けの `.flow.js` を用意しています。
型付き版はそれぞれ `perry-typescript`・`scriptc-typescript`・`oseo-typescript`・`static_hermes-flow` で選択し、同じ処理と期待値を保ちます。
`hello`・`primes`・`json` は標準 JavaScript のみで書いています。
`fetch-json` はさらに `fetch`・Promise・async/await を使います。その他は Node API や npm に依存し、ツールによっては未対応です。Node SEA の対象は `hello`・`primes`・`json`・`fetch-json` です。
Oseoは開発中の言語プロファイルに従い、Node API・npmパッケージ解決・`fetch` は未対応です。未対応のソースはコンパイル診断をそのまま報告します。
処理量を変更する場合は、全ツールで同じソースを使ってください。期待値が変わる場合は `scripts/benchmark.ts` の正答チェックも更新します。

## オブジェクトのキー変更

`object-stable` と `object-churn` は256個のオブジェクト、8種類の非整数キー、
20万回の更新で比較します。配列・オブジェクトの初期化も1回の処理に含みます。
読み出した値と更新後の状態を checksum に加え、正答を満たさない実行は計測失敗にします。
JS・TypeScript・Flow 版で同じ操作を行います。

安定版は既存キーにゼロを代入し、変動版は `delete` で削除して次の巡回で再追加します。
両方とも動的な `object[key]` アクセスです。変動版には削除・追加処理そのものの
コストと内部表現の変化が含まれるため、比率はJITの最適化失敗だけを表しません。
Node SEAにも対応し、`in-process` でウォームアップ後の処理時間を測れます。

```sh
pnpm cli bench --backend host --all --execution both --workload object-stable --mode in-process --samples 7 --warmup 3 --iterations 10
pnpm cli bench --backend host --all --execution both --workload object-churn --mode in-process --samples 7 --warmup 3 --iterations 10
```

Node SEA・Bun/Deno の実行ファイル化はJITを除去するものではありません。
ネイティブコンパイラとの比較では、その区別を保って結果を解釈してください。

## キャッシュとエンジン

`compile`・`run-binary`・`bench` で同じ構成を指定してください。
ここでのキャッシュはコード／バイトコード用であり、Docker のキャッシュや JIT のウォームアップとは別です。

| 構成 | キャッシュなし | キャッシュあり |
| --- | --- | --- |
| Node SEA | コードキャッシュなし | コードキャッシュを埋め込む |
| Bun | バイトコードなし | `--bytecode` で埋め込む |
| Deno V8 | `--no-code-cache` | 初回にディスクへ保存し、次回以降に再利用 |
| Deno QuickJS | キャッシュ切り替え対象外 | 指定不可 |

Deno QuickJS は `--tool deno-quickjs` で選びます。その他は `node-cache-on`・`bun-cache-off`・`deno-v8-cache-on` などの構成名で指定します。
Deno V8 の `run-binary --tool deno-v8-cache-on` は出力先の `runtime-cache/` を保持します。
一方、`bench` は計測セッション内だけでキャッシュを共有し、既存の `runtime-cache/` は使いません。

仕様：[Node SEA](https://nodejs.org/download/release/v24.21.0/docs/api/single-executable-applications.html#v8-code-cache-support) / [Bun](https://bun.sh/docs/bundler/executables#bytecode-compilation) / [Deno](https://docs.deno.com/runtime/reference/cli/compile/#choosing-a-javascript-engine)

## 中間ファイルと共有ライブラリ

実行ファイルは `build/docker/<構成>-<workload>/out` に出力します。次の中間ファイルも検証用に残します。

| ツール | 中間ファイル |
| --- | --- |
| Node | `out.sea.json`・`out.blob` |
| scriptc | `out.ll`（または `.c`）・`out.ir.json` |
| Perry | `intermediates/.perry-trace/llvm/` 内の LLVM IR |
| Porffor | `out.c` |
| Oseo | `out.c`・`out.mir` |
| Static Hermes | `out.c`・`out.ir`・`out.o` |

中間ファイルは通常の実行には不要です。生成処理も含むため、`compile` 全体の時間を純粋なコンパイル速度として比較しないでください。

Static Hermes は VM・console・JSI・Boost Context を静的リンクしています。
Hermes 固有の `.so` は不要ですが、ICU・libc・C++ ランタイムには依存し、完全な静的バイナリではありません。
古い成果物で `libshermes_console.so` などが要求される場合は再コンパイルしてください。
