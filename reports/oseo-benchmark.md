# Oseo: ベンチマークとMIR・生成Cの観察

2026-10-05、Apple M1 / macOS arm64。Oseo 0.1.0、revision
`317b58bbe686219ed9b715473c91ee2e9b5c5817`、Zig 0.16.0、Node 24.21.0。
ソースの展開先は `build/tools/oseo-317b58bbe686219ed9b715473c91ee2e9b5c5817/`。
計測・診断の生データとMIR/Cは `build/oseo-study-2026-10-05/`、
保存用スナップショットは [oseo-study-results.json](oseo-study-results.json)。

今回の範囲では、起動は軽いが、処理本体は汎用JSランタイムのコストが大きい。
生成Cの最適化、sanitizer、字句変数のセル化が実測に影響する。
数値型ヒントと名前付きプロパティの高速経路は存在するが、適用範囲が狭く、
既存のループ全体を単純なCの数値ループには変換していない。

## 計測条件

- 時間の測定は直列。各条件3つの新しいプロセスで実行。
- `hello` は起動から終了まで。各プロセス3回warmup、15回測定、`hrtime`。
- 他は初期化を含むワークロード1回の時間。適応的な呼出し回数でバッチ化し、
  2バッチwarmup、5バッチ測定。`Date.now()` の1ms単位。
  バッチ時間を呼出し回数で割り、プロセス内中央値、続いて3プロセスの中央値を取る。
- Oseoの条件は2周目に順序を反転。Nodeは入力配置パスの誤りを修正後、別の直列パスで3周測定。
  誤ったパスでの失敗はハーネスの問題であり、Nodeの性能・対応範囲の結果ではない。
- 全ての成功した実行で出力を検証。未対応TS入力は書き換えず、コンパイル失敗として保存。
- Oseo標準設定は上流のまま。ランタイムCは `-O2`、生成アプリケーションCには
  最適化指定がなく、address/undefined sanitizerあり。
  `-O2`追加とsanitizerなしは実験条件であり、通常のtool設定は変更していない。
- 診断カウンタとサンプリングは別の実行。カウンタ付きバイナリを時間の測定に使っていない。

対話中の1台のホストで、CPU固定・温度固定・OSキャッシュ破棄はしていない。
3プロセスから細かいp95や数%の差の有意性は主張しない。Docker/x86の比較も含まない。

## 標準設定の結果

単位はms。括弧内は3プロセスの中央値の最小–最大であり、信頼区間ではない。
`hello` と他の行は測定対象が異なる。

| ワークロード               |             Oseo JS |             Oseo TS |             Node JS |
| -------------------------- | ------------------: | ------------------: | ------------------: |
| hello、起動を含む          |    3.95 (3.93–3.96) |    3.75 (3.70–6.06) | 47.22 (47.17–47.31) |
| primes、100,000まで        | 1,528 (1,483–1,529) | 1,529 (1,487–1,531) |                6.53 |
| json、1,000レコード×100回  | 4,027 (3,999–4,031) |              未対応 | 35.00 (34.67–35.33) |
| object-stable、200,000更新 | 1,348 (1,348–1,349) |              未対応 |                8.00 |
| object-churn、200,000更新  | 1,300 (1,296–1,307) |              未対応 |               15.33 |
| addition、20,000関数呼出し | 40.00 (40.00–40.33) | 41.33 (41.33–41.67) |    0.02 (0.01–0.02) |

primes/json/stable/churnのOseo JSは、この設定ではNodeの約234/115/169/85倍の時間。
一方、helloの起動時間は約1/12。起動の軽さと定常処理の速さは分けて評価する。
additionのNodeバッチはJIT後に1–2msまで短くなり、時計の分解能の影響が大きい。
この行の正確な倍率や小差は評価しない。

TS失敗の内容は、jsonが4行目の `TSTypeAliasDeclaration is outside the M1 profile`、
object-stable/churnが4行目の配列・index signature型に対する
`This TypeScript type is not an M1 hint`。
primesや単純なnumber注釈のadditionは通るが、既存のTS入力全般が通るわけではない。
ここでのM1 profileはOseoの対応範囲の名称。

## Cコンパイル設定と変数の対照

生成アプリケーションCだけに `-O2` を追加し、ソースアルゴリズムを保った比較。
sanitizerなしの条件ではランタイムも再選択し、キャッシュキーを分離している。

| 条件                         |              primes |        object-churn |
| ---------------------------- | ------------------: | ------------------: |
| 標準                         |               1,528 |               1,300 |
| 生成Cも `-O2`、sanitizerあり | 1,050 (1,008–1,051) | 1,106 (1,102–1,113) |
| 生成Cも `-O2`、sanitizerなし |       704 (682–704) |       574 (568–581) |

標準比でO2のみはprimes約31%、churn約15%短縮。sanitizerなしまで含めると約54%/56%短縮。
ただし、この対照でもNodeとの差は大きく残る。
上流の [runtimeCompileFlags](https://github.com/dahlia/oseo/blob/317b58bbe686219ed9b715473c91ee2e9b5c5817/packages/toolchain-zig/src/index.ts#L182)
と [生成Cのコンパイル要求](https://github.com/dahlia/oseo/blob/317b58bbe686219ed9b715473c91ee2e9b5c5817/packages/toolchain-zig/src/index.ts#L383)
に設定差があり、実際のコマンド引数もJSONに保存してある。

primesは、閉じ込められたクロージャを作らないことを確認し、全ての `let` を `var` に変更した対照も測定。
このプログラムでは出力は双方9592。一般のJSプログラムで意味が同じになる置換ではない。

| primesの変数 |                標準 |     生成CもO2 | 1回の割り当て試行数、診断 |
| ------------ | ------------------: | ------------: | ------------------------: |
| 元のlet      |               1,528 |         1,050 |                 3,060,929 |
| var対照      | 1,109 (1,109–1,110) | 760 (759–760) |                     5,644 |

どちらのC設定でも約27%短縮。MIRでは `binding-reset` が7箇所から0箇所に減り、
countPrimesのroot枠も199から171スロットに減る。
生成Cではループの反復境界に `oseo_cell_create` / `oseo_environment_set` があり、
var版で除かれる。割り当ての大幅減少と時間短縮は、非脱出変数のセル化を改善候補とする根拠になる。
ただし、この対照はセル作成以外の命令も減らすため、全ての短縮をmallocだけには帰属しない。

## MIRと生成C

ここで保存したIRはOseoのMIR。LLVM IRは今回取得していない。
以下は計測用ラッパーを付ける前の入力の静的な件数で、実行回数ではない。
root数はMIRに宣言された枠。生成Cの一時root追加や実際のRSSとは区別する。

| 入力             | MIR root枠                 | safepoint箇所 | shape guard箇所 | checked SMI add箇所 |        Cのbytes |
| ---------------- | -------------------------- | ------------: | --------------: | ------------------: | --------------: |
| primes JS/TS     | countPrimes 199、script 31 |            45 |               0 |                   0 | 26,706 / 26,780 |
| primes-var JS    | countPrimes 171、script 31 |            38 |               0 |                   0 |          23,327 |
| json JS          | script 867                 |           172 |              10 |                   0 |          66,408 |
| object-stable JS | script 684                 |           146 |               1 |                   0 |          50,121 |
| object-churn JS  | script 686                 |           147 |               1 |                   0 |          50,284 |
| addition JS      | add 15、script 102         |            22 |               0 |                   0 |          15,780 |
| addition TS      | add 25、script 102         |            22 |               0 |                   1 |          16,529 |

primesのJS/TSは、位置情報、入力パス、埋め込まれたFunction.toString用ソース文字列を除くと
生成Cが一致する。TS注釈は、このループの演算をSMIやdoubleに特殊化していない。
実行部分には次のような流れが繰り返され、演算の周囲にstatus検査とroot保存がある。

```text
environment_get → cell_get → 汎用のmultiply/less_equal/remainder等
              → status検査 → root保存
```

参照: [primes MIR](../build/oseo-study-2026-10-05/primes/oseo-js/plain/out.mir)、
[primes C](../build/oseo-study-2026-10-05/primes/oseo-js/plain/out.c)、
[var対照 MIR](../build/oseo-study-2026-10-05/primes-var/oseo-js/plain/out.mir)。

単純な `add(left: number, right: number): number { return left + right; }` には
2つのSMI guard、unbox、checked add、box、汎用経路へのfallbackが生成される。
[特殊化の適格条件](https://github.com/dahlia/oseo/blob/317b58bbe686219ed9b715473c91ee2e9b5c5817/packages/compiler/src/mir-specialize.ts#L50)
は「2つのnumberヒント付き引数をその順序で足して返す、単一return」等。
今回のprimesの複数演算・分岐を持つ関数には該当しない。

診断では型付きaddに20,000 hits、0 missesがあり、汎用加算はJSの60,000回から
40,000回へ減った。しかし割り当て試行数は双方225,636回で、全体時間の短縮は観測しなかった。
`--no-specialization` の型付き対照も40.00ms。
生成Cを見ると、引数・環境・セル・mapped arguments・関数呼出しの処理は残っている。
この結果は高速経路が働かないという意味ではなく、演算1つの特殊化だけでは全体のコストを減らせない例。
型付き関数に文字列・小数・SMI範囲外になる加算を渡す別の診断も成功し、
1 hit、3 misses、うち1 overflow、出力 `[42,"x3",3.5,140737488355328]` を確認した。

参照: [型付きaddition MIR](../build/oseo-study-2026-10-05/addition/oseo-ts/plain/out.mir)、
[型付きaddition C](../build/oseo-study-2026-10-05/addition/oseo-ts/plain/out.c)。

## オブジェクトとjson

既存stable/churnの `object[key]` は動的キーで、MIRに固定slotの特殊化は生成されていない。
それぞれ1箇所あるshape guardは `Math.floor` の読み出し。
両方の199,999 hits / 1 missもこの場所のカウンタであり、更新対象オブジェクトのヒット率ではない。
両方の割り当て試行は1,809,758回で一致した。

名前付き読み出し `function readA(object) { return object.a; }` の別の診断では:

| 1,000呼出しの条件                       | hits | misses |
| --------------------------------------- | ---: | -----: |
| 同じオブジェクトを読む                  |  999 |      1 |
| 同じキー構成の2オブジェクトを交互に読む |    0 |  1,000 |
| 毎回delete後に再挿入して読む            |    0 |  1,000 |

現在の [object_create](https://github.com/dahlia/oseo/blob/317b58bbe686219ed9b715473c91ee2e9b5c5817/packages/runtime-c/native/runtime_object.c#L64)
はオブジェクトごとにshape_idを発行し、
[cache guard](https://github.com/dahlia/oseo/blob/317b58bbe686219ed9b715473c91ee2e9b5c5817/packages/runtime-c/native/runtime_object.c#L199)
はshape_idの一致を要求する。同じ構造を共有するshape interningではない。
deleteはプロパティを除去し、dictionary=true、新しいshape_idを設定する。
dictionaryのslot cacheは無効化される。

汎用検索の
[own_property_index](https://github.com/dahlia/oseo/blob/317b58bbe686219ed9b715473c91ee2e9b5c5817/packages/runtime-c/native/runtime_object.c#L36)
はproperty配列の線形走査。
json/churnの2秒サンプリングでは `oseo_internal_string_equal`、
`oseo_internal_own_property_index`、`oseo_internal_property_key_equal` が多く現れた。
jsonの名前付き読み出しは1,197 hits / 350,204 misses。
異なるレコード間でキャッシュが再利用されにくいことと整合する。
ただし、json全体にはparse/stringify・配列アクセス・文字列処理も含まれ、
これだけで総時間の原因を1つに確定しない。

stable/churnの速度差は小さく、今回の結果からV8のようなshape遷移のペナルティを推定できない。
churnでは最終的に残るプロパティが少なくなるため、線形走査の短縮も考えられるが、
これを確認するにはキー数を変える対照が必要。
既存checksumはundefinedと0の双方を許すので、別途aliasの同一性、delete後のキー不在、
再挿入後の列挙順を確認し、`[true,true,4,"b,a"]` を得た。

参照: [object-churn MIR](../build/oseo-study-2026-10-05/object-churn/oseo-js/plain/out.mir)、
[json C](../build/oseo-study-2026-10-05/json/oseo-js/plain/out.c)、
[診断データ](../build/oseo-study-2026-10-05/diagnostics.json)。

割り当てカウンタは初期化・出力も含む1ワークロードのmalloc/calloc/realloc等の試行数で、
オブジェクト個数ではない。全診断で処理中のcollectionsは0。
標準では `OSEO_GC_EVERY_SAFEPOINT` が未設定で、終了時の回収は測定バッチの外にある。
繰返し実行のメモリ挙動も今後の調査対象になる。

## 次の調査候補と再現

1. 生成CのO2を選択可能にした測定を続け、sanitizerあり/なしの結果を区別する。
2. 非脱出の字句変数・引数をセル/環境から直接値に下ろす対照を作る。
3. 数値ヒントを加算以外の演算・ループに伝えると、汎用ヘルパーをどれだけ減らせるか確認する。
4. 名前付き読み出しは共有shape、動的キーはキー数を変える対照で、線形探索とcacheの影響を分ける。

時間の測定と診断を同時に走らせず、次の順序で再現する。
既存結果を残すなら別の `--output` を指定し、診断・collectorにも同じディレクトリを渡す。

```sh
mise exec -- node scripts/experiments/oseo-study.ts --phase compile
mise exec -- node scripts/experiments/oseo-study.ts --phase measure
mise exec -- node scripts/experiments/oseo-probes.ts
mise exec -- node scripts/experiments/profile-object-shapes.ts build/oseo-study-2026-10-05/primes/oseo-js/measured/out build/oseo-study-2026-10-05/primes.sample.txt
mise exec -- node scripts/experiments/profile-object-shapes.ts build/oseo-study-2026-10-05/primes-var/oseo-js/measured/out build/oseo-study-2026-10-05/primes-var.sample.txt
mise exec -- node scripts/experiments/profile-object-shapes.ts build/oseo-study-2026-10-05/json/oseo-js/measured/out build/oseo-study-2026-10-05/json.sample.txt
mise exec -- node scripts/experiments/profile-object-shapes.ts build/oseo-study-2026-10-05/object-churn/oseo-js/measured/out build/oseo-study-2026-10-05/object-churn.sample.txt
mise exec -- node scripts/experiments/collect-oseo-study.ts
```

計測ハーネスが付けるdurations配列の `number[]` 注釈はOseoで未対応だったため、
Oseo用のラッパーでは配列の注釈を省略するよう修正した。
ワークロード自体の型注釈は保持する。型チェックと40件のテストが成功。
