# ツール更新（2026-10-05）

公開済みの最新リリースとnpmの`latest`を確認し、mise・workspace catalog・lockfile・Dockerの固定値を揃えた。Oseoはdefault branchのHEADを確認した。

| ツール            | 更新前    | 更新後    | 配布元                                                                                 |
| ----------------- | --------- | --------- | -------------------------------------------------------------------------------------- |
| Porffor           | alpha-6   | alpha-15  | [GitHub Release](https://github.com/CanadaHonk/porffor/releases/tag/alpha-15)          |
| scriptc           | 0.0.36    | 0.2.3     | [GitHub Release](https://github.com/vercel-labs/scriptc/releases/tag/v0.2.3)           |
| Static Hermes CLI | 2026.9.20 | 2026.10.1 | [GitHub Release](https://github.com/ssssota/static-hermes-cli/releases/tag/v2026.10.1) |
| Node              | 24.21.0   | 26.10.0   | [Current release](https://nodejs.org/en/blog/release/v26.10.0)                         |
| Deno              | 2.9.6     | 2.9.7     | [GitHub Release](https://github.com/denoland/deno/releases/tag/v2.9.7)                 |
| pnpm              | 12.3.4    | 12.9.1    | [GitHub Release](https://github.com/pnpm/pnpm/releases/tag/v12.9.1)                    |
| Aube              | 2.5.0     | 2.6.1     | [GitHub Release](https://github.com/aubepkg/aube/releases/tag/v2.6.1)                  |
| oxfmt             | 0.67.0    | 0.71.0    | [npm registry](https://registry.npmjs.org/oxfmt/0.71.0)                                |
| @types/node       | 24.13.4   | 26.6.4    | [npm registry](https://registry.npmjs.org/@types/node/26.6.4)                          |

Perry 0.5.1520・Bun 1.4.2・TypeScript 7.0.2・postject 1.0.0-alpha.6・lodash-es 4.18.1は公開済み最新版のため据え置いた。OseoのHEADは既存の`317b58bbe686219ed9b715473c91ee2e9b5c5817`と一致した。ZigはOseoのmise設定が指定する0.16.0を維持した。

Static Hermesの同梱manifestはHermes revision `6e2181b288b0306d8bd1988d38d32aa879b745d5`。Porffor・Static HermesのLinux x64/arm64とAubeのLinux x64のSHA-256を配布元のasset digestに更新した。

## 起動・コンパイル処理の変更

- scriptc 0.2系はTypeScript 7のネイティブparser/checker等を同梱するネイティブCLI。workspaceの`scriptc/bin/scriptc.exe`を直接起動する。旧`dist/bootstrap.js`への依存を除いた。
- LLVMが唯一のコード生成バックエンドになり、C出力・Cへのfallbackが廃止された。`--keep-c`を`--keep-llvm`に変更し、IR JSONも保持する。実際の中間ファイル名は`<workload>.ll`・`<workload>.ir.json`。比較スクリプトから旧`scriptc-c`構成を除いた。
- scriptcの公式postinstallはプラットフォーム別バイナリの配置・toolchain manifestの作成に必要になった。pnpmの`allowBuilds`とDockerのnpmでscriptcに許可を設定した。pnpmが追加したrelease-age例外は0.2.3のCLIと各プラットフォームパッケージだけに固定した。
- TS版`object-stable`は、256要素を挿入済みの配列を`i % 256`で読む箇所に非nullアサーションを追加した。更新版scriptcが受け手を`record | undefined`と扱う問題を避ける型注釈で、実行時の処理と期待値は同じ。
- Aubeのmiseインストールでは、署名workflowが`release-plz.yml`から`release.yml`へ変わったため既存pinが拒否された。公式タグのworkflow差分でPackslip処理の移動を確認し、このプロジェクトのsigner pinを再取得した。署名・checksumの検証は維持した。

## 検証

- `pnpm install --frozen-lockfile`・型検査・40件のテスト・変更ファイルのformat検査に成功。
- macOS arm64で全16構成の`hello`をコンパイル・実行し、正答を確認。
- Porffor・scriptc・Static HermesのJS版は`primes`・`json`・`object-stable`・`object-churn`の正答を確認。型付きの追加確認を合わせ、ホストの36条件中33条件が成功。
- ベンチマーク経路も12条件で正答を確認。素数はJS/TS/Flow、Porffor・scriptcのJSはJSONと両オブジェクトworkloadを含む。これは動作確認用の短い計測で、性能比較用の再測定ではない。
- DockerはNode・Deno・Bun・Perry・scriptc・Static Hermes・Oseo・共通benchmarkのlinux/amd64イメージと、Porfforのlinux/arm64イメージをビルド。
- Dockerでも全16構成の`hello`に成功した（Porfforはarm64、それ以外はamd64をMac上で実行）。Porffor arm64の素数・JSON・両オブジェクトworkloadも正答を確認し、Dockerの20条件はすべて成功。

未対応・制約も確認した。

| 条件                                           | 更新版の結果                                                 | 旧版との確認                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| scriptc TS / json                              | SC1043でコンパイル失敗                                       | 0.0.36でもSC2011で失敗                                                                             |
| scriptc TS / object-churn                      | `delete`の受け手がunion型として拒否される                    | 0.0.36でも実行時にmissing keyで失敗。非nullアサーションを付けた0.2.3も実行時に失敗                 |
| Static Hermes Flow / object-churn              | `Checked cast failed`                                        | 2026.9.20でも同じ失敗                                                                              |
| scriptc JS / 最小の参照共有probe               | 配列から取り出したobjectを更新しても配列側は`0`。期待値は`9` | 0.0.36・0.2.3とも`0`。既存の比較スクリプトのsemantics gateを維持                                   |
| Porffor Linux x64 / MacのDocker上で`--version` | exit 139                                                     | alpha-6・alpha-15とも再現。arm64ではalpha-15の起動・ビルドに成功。x64のネイティブLinux実行は未検証 |

scriptcのJSオブジェクトworkloadはchecksumに一致しても、最小の参照共有probeは失敗する。従来どおり、このprobeを満たさない構成のオブジェクト性能は比較に採用しない。

ログ・実行ファイル・C/IR・検証用スクリプトは`build/tool-update-2026-10-05/`。既存の`oseo-benchmark.md`・`native-comparison.md`とその計測結果は旧バージョンの記録として保持した。

更新前後を同じAC電源条件で測り直した結果は[性能比較](tool-update-performance.md)に保存した。Porfforの固定キー更新は5.6%短縮、scriptcのJSONは74.5%増加、NodeのJSONは23.2%短縮。旧版も再測定した5ペアの値で、バッテリー駆動だった旧レポートとの時間差は更新効果として扱っていない。
