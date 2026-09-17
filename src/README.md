# ワークロード

コマンドの使い方は[ルートの README](../README.md)を参照してください。

| 名前 | 処理 | 期待する結果 |
| --- | --- | --- |
| `hello` | ログを1回出力 | `hello` |
| `primes` | 100,000 以下の素数を数える | `9592` |
| `json` | JSON の生成・解析・加工・再生成 | `1491500` |
| `fetch-json` | ローカルHTTP取得・JSON解析・加工 | `14915` |
| `file-cli` | ファイルの行数・単語数を数える | 付属データで `{"lines":2,"words":6}` |
| `http-server` | HTTP サーバーを起動 | `GET /` に `hello` を返す |
| `npm-cli` | lodash-es で文字列を kebab-case に変換 | 引数なしで `hello-native-java-script` |

```sh
# リポジトリのルートで実行
pnpm cli run --workload file-cli
pnpm cli run --workload npm-cli -- 'Hello World'
pnpm cli run --workload http-server --port 3000
```

プログラムへの引数は `--` の後に渡します。`npm-cli` の依存はworkspaceのcatalogで管理し、Docker実行前に `pnpm deploy` で独立配置します。
HTTP は localhost に公開し、Ctrl-C で停止します。`GET /` 以外は404です。

各ワークロードには標準の `.js` に加えて、Perry・scriptc向けの `.ts` とStatic Hermes向けの `.flow.js` を用意しています。
型付き版はそれぞれ `perry-typescript`・`scriptc-typescript`・`static_hermes-flow` で選択し、同じ処理と期待値を保ちます。
`hello`・`primes`・`json` は標準 JavaScript のみで書いています。
`fetch-json` はさらに `fetch`・Promise・async/await を使います。その他は Node API や npm に依存し、ツールによっては未対応です。Node SEA の対象は `hello`・`primes`・`json`・`fetch-json` です。
処理量を変更する場合は、全ツールで同じソースを使ってください。期待値が変わる場合は `scripts/benchmark.ts` の正答チェックも更新します。

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
| Static Hermes | `out.c`・`out.ir`・`out.o` |

中間ファイルは通常の実行には不要です。生成処理も含むため、`compile` 全体の時間を純粋なコンパイル速度として比較しないでください。

Static Hermes は VM・console・JSI・Boost Context を静的リンクしています。
Hermes 固有の `.so` は不要ですが、ICU・libc・C++ ランタイムには依存し、完全な静的バイナリではありません。
古い成果物で `libshermes_console.so` などが要求される場合は再コンパイルしてください。
