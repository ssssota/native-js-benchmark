# Native JS Dream

JavaScript を各ツールで実行ファイルにし、サイズ・起動時間・反復処理の速度を比較する実験です。
Node.js 24 以上・pnpm・Docker が必要です。

## ビルド・実行

```sh
# 全11構成をコンパイル（必要な Docker イメージも自動ビルド）
pnpm cli compile --all --workload hello

# 1構成だけコンパイルして実行
pnpm cli compile --tool bun-cache-on --workload hello
pnpm cli run-binary --tool bun-cache-on --workload hello

# ソースを実行
pnpm cli run --tool node --workload primes
```

- `--tool`：下表の構成名を直接指定します。
- `--variants --tool deno`：Deno の V8 キャッシュなし・あり・QuickJS をまとめて選択。
- 省略時は `node`・`hello`。コンパイル・計測では `node-cache-off` 相当です。

| ツール | バイナリ構成 | 通常起動 |
| --- | --- | --- |
| Node | `node-cache-off` / `node-cache-on` | `node-source` |
| Bun | `bun-cache-off` / `bun-cache-on` | `bun-source` |
| Deno | `deno-v8-cache-off` / `deno-v8-cache-on` / `deno-quickjs` | `deno-source` |
| AOT | `perry` / `scriptc` / `porffor` / `static_hermes` | — |

`--cache`・`--engine` は廃止しました。出力先の名前は変わりません。
短い `node`・`bun`・`deno` も使えます。単体コンパイル・計測ではキャッシュなし（Deno は V8）、一覧表示ではそのツール全構成を選びます。

出力先は `build/docker/bun-cache-on-hello/out` など。`compile` は毎回コンパイルしますが、Docker のビルドキャッシュは使います。
Docker版は `build/docker/`、ホスト版は `build/host-darwin-arm64/` 以下にまとめます。旧配置の `build/` 直下にある成果物・結果は自動移動せず、一覧にも表示しません。利用する構成を再コンパイル・再計測してください。
Deno の V8／QuickJS 用ランタイムと Node の `postject` はイメージ作成時に取得します。通常のコンパイルでは再ダウンロードしません（npm 依存の取得やクロスコンパイルは別）。
`run` は Node/Bun/Deno ではソースを実行し、その他ではコンパイル後に実行します。キャッシュ・エンジンの比較には `run-binary` を使ってください。

ワークロードと対応上の注意は [src/README.md](src/README.md)、その他のオプションは `pnpm cli help` を参照してください。

## サイズ比較

```sh
pnpm cli sizes --workload hello
pnpm cli sizes --workload hello --tool deno
```

既存バイナリを読み、実行ファイルのサイズ（`Binary`）が大きい順に表示します。再ビルドはしません。

KiB・MiB 単位で表示し、未ビルド・サイズ不明は末尾に置きます。
共有ライブラリ・中間ファイル・キャッシュはサイズに含めません。
非システム共有ライブラリへの依存が見つかった場合は警告します。
動的に読み込むライブラリや外部データも検出しないため、配布に必要な総容量とは限りません。

## 速度比較

通常のソース直接実行も Node・Deno・Bun で計測できます（事前コンパイル不要）。

```sh
pnpm cli bench --all --execution source --workload hello
pnpm cli bench --tool node-source --workload primes --mode in-process
# バイナリ11構成＋通常起動3構成をまとめて計測
pnpm cli bench --all --execution both --workload hello
```

`bench` の `--execution` は `binary`（既定）・`source`・`both` から選びます。
`source` は各ランタイムの通常設定（Deno は `run -A`）を使います。`--tool node-source` などの指定時は `--execution source` を省略できます。
ダウンロード・ディスクキャッシュは同じ計測セッション内で再利用します。
プロセス内計測ではバイナリ版と同じループを生成し、コンパイルせずに実行します。
結果は `node-source`・`deno-source`・`bun-source` の名前で別保存します。
`bench-results` は既定で両方を一覧表示し、`--execution binary` / `source` で絞れます。

```sh
# プロセスを毎回起動：事前に compile が必要
pnpm cli bench --all --workload hello --samples 30

# 同じプロセス内で反復：計測専用バイナリを自動生成
pnpm cli bench --all --workload primes --mode in-process --samples 30 --iterations 100

# 保存済み結果の一覧（再計測なし、中央値の速い順）
pnpm cli bench-results --workload hello
pnpm cli bench-results --workload primes --mode in-process
```

`--tool` で対象構成を絞れます。計測モードは次の2種類です。

| モード | 計測対象 | 用途 |
| --- | --- | --- |
| `process`（既定） | プロセス起動から終了まで。実処理・出力も含む | `hello` で起動コストを比較 |
| `in-process` | 同じプロセス内で workload を繰り返し呼ぶ | 初回から後半への速度変化を比較 |

| オプション | `process` の既定 | `in-process` の既定 |
| --- | --- | --- |
| `--samples`（集計対象の計測回数） | 50プロセス | 5バッチ |
| `--iterations`（1バッチ内の反復数） | 指定不可 | 50回 |
| `--warmup`（集計しない先頭の回数） | 5プロセス | 1バッチ |

既定ではプロセスを計55回起動し、プロセス内では1プロセスで合計300回 workload を実行します。
プロセス内の5サンプルは簡易比較向けです。ばらつきや p95 を詳しく見る場合は `--samples` を増やしてください。
初回からの速度変化を見たい場合は `--warmup 0` を指定してください。
タイムアウトはプロセスごとの計測では1起動あたり2分、プロセス内計測では全反復で10分です。

全構成を Node＋Debian＋ICU の[共通イメージ](dockerfiles/benchmark.dockerfile)で順番に計測します。
コンパイルは各ツールのイメージで行い、コンパイル・Docker 起動・計測用 Node 起動は時間に含めません。
計測前にバイナリとソース（依存パッケージ・付属データを含む）をコンテナ内へコピーします。コピー時間は除外し、Docker Desktop のホスト共有領域から直接実行しない条件に揃えます。
`/src/...`・`/out/...` の引数もコピー先へ置き換えます。それ以外の外部パスは自動コピーしません。
結果一覧の `Inputs` が `container-local` の結果同士で比較してください。旧結果は `legacy/unknown` と表示します。
通常の `run`・`run-binary` は引き続き各ツールのイメージを使います。

結果は `build/docker/bench-<mode>-<構成>-<workload>/result.json` に保存します。
全サンプル・中央値・p95・初回・最終回・計測条件を記録し、同じ構成で再計測すると上書きします。

### 比較時の注意

- プロセス内計測は `hello`・`primes`・`json`・`fetch-json` に対応。末尾のログを戻り値に置き換えるため、`hello` はログ出力性能の計測にはなりません。
- プロセス内の時計は1 ms精度です。短い処理には `--iterations` を増やしてください。
- 計測ごとに新しいコンテナを使いますが、その中の反復間では Deno のディスクキャッシュなどを再利用します。OS のページキャッシュは消しません。
- 速度変化には JIT 以外に GC・CPU 負荷なども影響します。Docker Desktop 上では Linux VM 内の性能です。
- HTTP サーバーは計測対象外です。起動完了やリクエスト性能には別の計測が必要です。
- 古い結果は現在のバイナリ・実行環境と異なる場合があります。条件を揃えて再計測してください。

## HTTP取得・JSON加工

```sh
pnpm cli bench --all --execution source --workload fetch-json
pnpm cli compile --all --workload fetch-json
pnpm cli bench --all --execution both --workload fetch-json --mode in-process
```

`fetch-json` は固定の1,000件のJSONを取得し、絞り込み・集計・文字列加工・再シリアライズを行います。正答は `14915` です。
同じコンテナの別プロセスでサーバーを起動し、`127.0.0.1:31337` の準備完了後に計測します。外部ネットワーク・ポート公開は使いません。
サーバー起動・JSON生成・終了処理は計測対象外。リクエスト数も検証し、レポートの `fixture` に保存します。
プロセス内では各リクエストを順次 `await` し、接続再利用はランタイムの既定動作に任せます。通信・サーバー負荷も含むため、純粋な JIT 比較ではありません。
`run`・`run-binary` でも専用サーバーを自動起動します。これらも、この workload に限り共通イメージを使います。
`fetch`・Promise・非同期処理が未対応のツールは失敗として報告し、別実装への置き換えはしません。
動作確認済み：Node・Deno・Bun の通常起動／全バイナリ構成、Perry、scriptc（両モード）。Porffor・Static Hermes は結果を出力せず終了するため、現状は計測失敗になります。

## 開発

### Macホストで計測（試験対応）

Docker版を残したまま、`--backend host` でMac上に直接起動できます。全ツールに対応していますが、workloadの `npm-cli` はまだ対象外です。各ツールで使えるJSの機能は異なります。

Perryはworkspaceの `@perryts/perry` を使用します（LLVM同梱）。リンクにはXcodeまたはCommand Line Toolsが必要です。ソースを成果物内に隔離してコンパイルし、`intermediates/` にLLVM IR・オブジェクト等を保存します。生成バイナリはOS標準以外の共有ライブラリに依存していないことを検査します。

`mise.toml` で Node 24.21.0・Deno 2.9.6・Bun 1.4.2・pnpm 12.3.4 を固定します。Nodeは公式配布バイナリを使います。pnpm更新時は `package.json` の `packageManager` も揃えてください。Docker側は独立したままです。
pnpmはmiseのaquaバックエンドで配布済みバイナリを取得します（npm経由ではありません）。Nodeの署名検証を有効にしているためGnuPGが必要です。古いmiseで署名鍵不足になる場合はmiseを更新するか、Node公式の公開鍵を確認して追加してください（検証は無効にしません）。

```sh
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
```

以下はmiseをシェルで有効にした状態で実行します。未設定の場合は各コマンドの前に `mise exec --` を付けてください。

```sh
node scripts/cli.ts compile --backend host --tool node-cache-on --workload hello
node scripts/cli.ts bench --backend host --tool node-cache-on --workload hello
node scripts/cli.ts bench --backend host --tool deno-source --workload fetch-json --mode in-process
node scripts/cli.ts bench-results --backend host --workload hello
node scripts/cli.ts sizes --backend host --workload hello
```

NodeはCLI自身を起動したバイナリを使います。SEA作成にはプロジェクトのpostjectとmacOSの `codesign` が必要です。以前の環境で作った成果物・計測結果は自動削除しないため、比較対象はmise環境で再ビルド・再計測してください。
Node SEAの作成前に共有ライブラリを検査し、OS標準以外への依存があれば失敗にします。

Static Hermesは `vendor/hermes` のsubmoduleからビルドします。CMake・Ninja・Pythonはmise管理、コンパイラとSDKにはXcodeまたはCommand Line Toolsが必要です。

```sh
git submodule update --init vendor/hermes
mise install
mise exec -- pnpm cli build --backend host --tool static_hermes
mise exec -- pnpm cli run --backend host --tool static_hermes --workload hello
mise exec -- pnpm cli bench --backend host --tool static_hermes --workload hello
```

コンパイラは `build/host-<OS>-<arch>/hermes/bin/shermes` に配置します。`compile` / `run` でも自動で差分ビルドします（初回は数分）。生成物は `out`・`out.c`・`out.ir`。VMを静的リンクし、実行バイナリがOS標準以外の共有ライブラリに依存していないことを検査します。Xcodeのバージョンはmiseでは固定しません。

成果物・結果は `build/host-darwin-arm64/` 以下に保存し、Docker版とは分離します。ランタイムのバージョン・CPU・OS情報も結果に記録します。`sizes` はMach-Oのファイルサイズと依存先を表示し、依存ライブラリの容量は含めません。

計測ごとに専用の一時領域・キャッシュ先を用意し、反復間では再利用、終了時には削除します。ホスト環境はサンドボックスではなく、OS・電源設定・他プロセスの負荷は固定されません。`fetch-json` はMac上の別Nodeプロセスでポート31337を使うため、同時実行は避けてください。Denoのコンパイル時のランタイム取得は初回にネットワークを使います。

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
```

pnpmはmiseで管理します。workspaceはルート（CLI・コンパイラ）と `src`（workload）の2つで、依存バージョンは `pnpm-workspace.yaml` の `catalog` に集約しています。変更後は `pnpm install` でlockfileを更新してください。
Perry・scriptcはworkspaceの固定パッケージを使用します。PorfforはmiseでGitHub Releasesの `alpha-6` を取得し、Dockerも同じバージョンに固定しています。配布アーカイブのSHA-256も固定しています。hostのPorffor・scriptcにはXcode Command Line Tools等のCコンパイラ／SDKが必要です。`run` はコンパイル後に実行、`bench` は生成バイナリを計測します。Porfforは `out.c`、scriptcは `*.ll`・`*.ir.json` 等の中間ファイルも保存します。`vendor/hermes` はworkspaceに含めません。
Dockerの `npm-cli` は `pnpm deploy` で `build/docker/workload-deps-*` に独立配置してから使います。旧 `src/package-lock.json` は廃止し、ルートの `pnpm-lock.yaml` に統一しました。現状のworkload依存は純粋なJSのlodash-esのみで、将来ネイティブ依存を追加する場合はLinux向けの配置方法も見直してください。

CLI は `scripts/cli.ts`、コンパイル設定は `scripts/compilers/` にあります。
プロセス内ループの生成は `scripts/benchmark.ts`、プロセス起動の反復は `scripts/benchmark-runner.ts` です。
