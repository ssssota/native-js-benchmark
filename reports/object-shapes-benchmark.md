# Object workload追試: AOT/JITではなく、何が性能を決めているか

2026-09-25、Apple M1 / darwin-arm64。元の測定は [`tmp.log`](../tmp.log)、追試の全238 case/targetの結果・失敗・各batch・ソースhash・バージョン・V8診断は [`object-shapes-study-results.json`](object-shapes-study-results.json)。再現手順は [`scripts/experiments`](../scripts/experiments/README.md)。本稿の新しい表は追試の値であり、元のログとの合算ではない。

## 結論をどう改めるか

元の問いは「shapeが安定しないとJITの優位が失われ、AOTが有利になるか」だった。しかし追試で強く支持されたのは、**実行時に選ばれるオブジェクト表現とアクセス経路が、AOT/JITという分類以上に効く**という説明である。

- **scriptc JSの8.5秒は、主に8キーの比較分岐のせいではない。** 配列の1要素を読むために配列全体をtyped recordへ変換している。配列長を変える実験、固定キーの対照、IR、sampling profileが同じ原因を指す。参照同一性を壊す最小例もあり、単なる低速実装として順位表に置くことにも注意が必要。
- **元のchurnは、ほぼ空のオブジェクトの追加・削除を測っていた。** 8キーを保持する条件、32/128キー条件ではPorfforの優位が消える。生成Cの線形探索と削除時の詰め直しから、この変化を予測できる。
- **V8が測定中にdeoptを繰り返す、という説明は今回のtraceでは支持されない。** dictionary化だけの対照はむしろ速い。churnでもJIT有効のNodeは`--jitless`より約2.3倍速い。最適化の消失というより、より高価な動的操作を行う定常経路へ移る、と読むべき。
- **AOTもshape依存の高速経路を持つ。** 削除なし・固定キーでもPorffor/Hermes/Perryはshape多様性に反応する。一方、scriptcの明示record型は挿入順の違いを固定layoutに吸収できた。ただし静的表現には削除・欠損値・参照変換の制約がある。

「AOTの勝ち／JITの勝ち」ではなく、**速いときに何を仮定でき、仮定を外すとどの処理に落ちるか**が、今回見極められた特徴である。

## 1. 元のworkloadは何を測っていたか

### 1.1 churnの大部分では8キーを保持していない

元のループは`objects[i % 256]`に対し、`keys[Math.floor(i / 256) % 8]`を代入・読出し・削除する。キーはオブジェクト256個を一巡するごとに次へ進む。

| 完了した更新数 | 全256個のown property数 | 状態                             |
| -------------: | ----------------------: | -------------------------------- |
|              0 |                   2,048 | 各8キー                          |
|            256 |                   1,792 | 各7キー                          |
|          2,048 |                       0 | 全て空                           |
|      2,049以降 |       各反復の終了時は0 | 選んだ1個だけが一時的に0→1→0キー |

これはソースからの帰結であり、V8の実測でも確認した。初期キーを削除し終えた後が全200,000更新の98.976%を占める。「多数のプロパティを保持したオブジェクトが変形し続ける」ケースの代表とは言いにくい。

またV8では最初の256更新で全オブジェクトがfast propertiesからdictionaryへ移る。その後の追加・削除を、毎回異なるfast HiddenClassへの遷移と同一視してはいけない。関数を再呼出しすれば新しいobject群なので初期段階は繰り返すが、各呼出しの大部分はdictionaryの定常操作である。

### 1.2 checksumの一致だけでは意味論を保証しない

元の終了確認は`undefined`または`0`を許す。このため、削除を0代入で代用する誤実装を検出できない。また、更新してすぐ同じローカル変数から読むだけでは、「配列から取り出す際にオブジェクトをコピーしてしまう」誤実装も通る。

追試はreset後に厳密に`0`、delete後に厳密に`undefined`を要求し、別途、参照同一性・更新の永続性・`in`・`Object.keys`を検査した。性能表はそのworkloadのchecksumが全呼出しで一致したものに限る。ただしこの有限個の検査は、JS全体への適合性証明ではない。

## 2. 対照実験と測定条件

更新系は256オブジェクト・200,000更新を基本に、次を変更した。`K`はキー名の数。

| 名前                     | 変更点                                                          | 主に切り分けるもの                        |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------- |
| `reset-K`                | 代入・読出し後に0へ戻す                                         | 元stable相当の基準                        |
| `drain-8`                | 削除後を厳密に検査                                              | 元churnの構造を維持                       |
| `keep-K`                 | 削除・欠損確認後に0を再挿入                                     | 各反復の境界でKキーを維持                 |
| `empty-8`                | 最初から空で追加・削除                                          | 初期8キーの履歴を除く                     |
| `dictionary-K`           | 先頭sentinelを初期化時だけ削除、その後はreset                   | 事前構造変更と毎回の変更を分ける          |
| `undefined-8`            | 削除せずundefinedを代入                                         | 値の型・undefined判定とキーの不在を分ける |
| `named-shapes-1/4/16`    | 同じ8キーを異なる順序のliteralで作り、共有する`.a`を200万回読む | 削除・動的キーなしのreceiver多様性        |
| `array-1/16/64/256/1024` | 更新数2万で固定、配列長だけ変更                                 | scriptcのアクセス当たり計算量             |

`dictionary`は実験名であり、dictionary化を確認したのはV8。他の実行系にも同じ事前削除を行うが、その内部表現までdictionaryと呼ぶものではない。

`keep`には復元の代入が1回増える。従って`keep - drain`を純粋なshape維持コストとは解釈しない。キー数を変えたreset、同じkeep同士、削除しないnamed-shapesも併用する。初期化も時間に含むため、Kやliteral数を増やす比較には初期化量の差も残る。

測定条件:

- Node 24.21.0 / V8 13.6.233.17-node.53、Bun 1.3.1、Deno 2.9.6 / V8 15.0.245.2-rusty、Porffor alpha 6 (`038f415`)、Perry 0.5.1520、scriptc 0.0.36、Static Hermes 0.0。設定ファイルの指定ではなく、実際に呼び出したバージョンを保存した。
- throughput/shapesは通常3つの新しいプロセス。各プロセスでpilotを2回実行し、約100msを目標にbatchの呼出し数を1〜50へ調整、2 batchをwarm-up、7 batchを測定。表は「各プロセスの中央値」の中央値。drainの主要6実行系とHermesの16-shapeは5プロセスで確認し直した。
- 時計は移植性のため`Date.now()`。pilot後のJIT高速化で測定batchが100ms未満になることもある。1ms分解能・少数プロセスなので、数%の差やtail latencyの断定には使わない。独立プロセス単位のmin/maxもJSONに保存した。
- scalingだけは元のglobalなJS形式を保ち、1回の未計時実行後、5回のspawn〜終了を`hrtime`で測定。この表の小さい値には起動コストが含まれる。semanticsの所要時間は性能比較に使わない。
- ベンチマーク同士は並列実行していない。ただし対話利用中のホストで、CPU固定・温度固定はしていない。初回passには大きな揺れがあり、確認前の結果も`build/object-shape-study-2026-09-25/summary-*.json`に残した。Hermes 16-shapeは再測定でも22.6〜34.3msと揺れた。
- 旧in-processは50呼出し×5測定batch・warm-up 1 batch。追試とはwrapper、検査式、反復数が異なる。旧値との差をコンパイラの改善や純粋な起動時間と解釈しない。

## 3. 更新系の結果

更新200,000回あたりのms。`pre-delete`は実験名`dictionary-8`。小数第2位へ丸めた。

| 実行系           | reset |  drain |   keep | pre-delete | undefined代入 |
| ---------------- | ----: | -----: | -----: | ---------: | ------------: |
| Node             |  5.00 |   9.30 |  11.00 |       4.10 |          5.06 |
| Node `--jitless` | 17.17 |  21.60 |  22.40 |      16.00 |         16.57 |
| Bun              |  2.59 |  12.13 |  15.50 |       2.59 |          2.55 |
| Deno/V8          |  5.29 |   9.67 |  11.13 |       4.45 |          5.35 |
| Porffor          |  8.75 |   9.00 |  13.13 |       8.50 |          8.42 |
| Static Hermes JS | 16.00 |  27.50 |  33.33 |      16.00 |         15.71 |
| Deno/QuickJS     | 37.00 |  39.67 |  49.00 |      37.00 |         37.67 |
| Perry JS         | 22.40 | 920.00 | 844.00 |      27.50 |         22.40 |
| Perry TS         | 12.57 | 163.00 | 236.00 |     100.00 |         12.43 |

元の傾向は再現するが、説明が変わる。PorfforのdrainはNodeに近く、keepではNodeより時間がかかる。undefinedを値として格納するだけでは、多くの実行系で大きく遅くならない。事前に1回削除しても、その後は安定更新なら速い系もある。

つまり「undefinedが出た」「一度shapeを変えた」「JITがある」だけでは遅さを説明できず、**構造変更を繰り返すことと、その後のキー探索・欠損確認をどう実装するか**を見る必要がある。

## 4. scriptc: 628倍差の主因を切り分ける

### 4.1 要素アクセス前に全配列を変換している

元の[JS版LLVM IR](../build/host-darwin-arm64/scriptc-object-stable/object-stable.ll)では、更新ループ内で次の順序になる。

```text
dynamicなobjects配列
  → sc_dc_0(objects): array<record:r0>へ変換
      → 新しいtyped配列を確保
      → 配列の全要素についてsc_dc_1
          → recordを確保し、a〜hの8フィールドを取得・検査・コピー
  → scr_arr_get_ref(変換済み配列, i % 256)
  → 一時配列をrelease
  → 得たrecordへ、今回必要な更新を行う
```

ループ内の`sc_dc_0`呼出しはIRの753行付近、全要素変換のループは511行以降、record構築は`sc_dc_1`内。必要なのは1要素なのに、N要素を変換している。元の条件なら200,000×256 = **5,120万record変換**、その中で**4億960万フィールド取得・検査**相当になる。これはIRから算出した回数であり、allocation counterによる実測ではない。

この後に8キーの`scr_str_eq`比較列もある。しかし前版の「recordの比較列とMapの差が主因」という説明では、全配列変換という最大の要因を落としていた。

### 4.2 配列長を変えると予測どおりほぼ線形に伸びる

更新数2万のprocess測定。明示recordはrecord配列型とキーのunion型を指定、Mapは数値index signatureを指定した入力。

| 配列長N | JS推論版 ms | 明示record ms | 明示Map ms |
| ------: | ----------: | ------------: | ---------: |
|       1 |        8.73 |          3.93 |       2.67 |
|      16 |       58.68 |          4.01 |       2.97 |
|      64 |      216.84 |          3.82 |       2.85 |
|     256 |      869.64 |          3.88 |       2.86 |
|   1,024 |    3,427.29 |          3.70 |       3.03 |

N=64→256→1,024ではJS版が216.8→869.6→3,427.3msと約4倍ずつ増える。N=256の869.6msから更新数を10倍に外挿した約8.70秒は、元の200,000更新の8.51秒に近い。

さらにN=256のまま`object[key]`を全て`object.a`にすると、JS版は869.6→859.5ms。動的キー比較を除いても約1%しか変わらない。一方、明示record版は3.88→2.40msと改善する。**キー比較のコストはあるが、JS版の異常な遅さを支配するのはその手前の変換**と判断できる。

2秒の[sampling profile](../build/object-shape-study-2026-09-25/scriptc-stable.sample.txt)でも、`sc_dc_1 → scr_dyn_obj_get → memcmp`のstackが目立つ。top-of-stackは`memcmp`761、`scr_dyn_obj_get`433、`memcmp`stub107、`sc_dc_1`88サンプル。一方`scr_str_eq`は主なhotspotではない。「文字列比較が多い」点は合っていても、**どの処理が比較を増幅したか**が違っていた。

### 4.3 遅さと参照意味論の破綻が同じ変換と整合する

次の最小例はNode/Bun/Deno/Porffor/Perry/Hermesで7、scriptc JS推論版で0になった。

```js
const objects = [];
objects.push({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0 });
const object = objects[0];
object.a = 7;
console.log(objects[0].a);
```

`object === objects[0]`もfalse、配列から取り直しながら1,000回加算した最終値も0。明示record/Map配列ではこれらを通過した。変換で別recordが作られ、元のdynamic objectへ変更が反映されない、という読みとIRが一致する。

元のchecksumが正しかったことをもって「全実行系が同じJS意味論を実行した」とは言えない。元の更新・読出しは同じ一時recordで完結するため、この問題を隠していた。

### 4.4 scriptcの強みも別の実験では現れる

変換を除いた後の表現選択にも差はある。追試resetのin-processでは明示recordが17.00ms、Mapが7.20ms。一方、後述の固定`.a`読出しではrecordが約8.6ms、Mapが約18msと逆転する。

recordは**フィールド位置を静的に決められる場合**に強く、文字列キーで何度も振り分ける場合にはMapが有利になる。今回見えたのは「TSなら速い」ではなく、静的layoutが成立する範囲、その境界での変換コストと意味論の問題である。

## 5. Porffor: 「shape変化に強い」より「小さい表が安い」

Porfforの[生成C](../build/host-darwin-arm64/bench-in-process-porffor-object-churn/out.c)では、`p32___Porffor_object_lookup`が20 bytes刻みのentryを線形走査する。`p60___Porffor_object_delete`は該当entryを探し、要素数を減らし、末尾でなければ後続entryを`memmove`する。

この実装から二つの予測が立つ。

1. 空→1要素→空なら探索も詰め直しも非常に小さい。元churnには好条件。
2. 多くのキーを保持すれば、線形探索と移動の仕事が増える。AOTであることはデータ構造の計算量を消さない。

同じ200,000更新、同じ操作でKだけ変えた結果は次のとおり。

| 実行系           | reset 8 | reset 32 | reset 128 | keep 8 | keep 32 | keep 128 |
| ---------------- | ------: | -------: | --------: | -----: | ------: | -------: |
| Node             |    5.00 |     7.38 |     12.25 |  11.00 |   10.75 |    11.57 |
| Bun              |    2.59 |     2.59 |      2.89 |  15.50 |   16.50 |    16.50 |
| Deno/V8          |    5.29 |     7.75 |      4.73 |  11.13 |   10.63 |    11.25 |
| Porffor          |    8.75 |    12.88 |     30.00 |  13.13 |   18.50 |    43.67 |
| Static Hermes JS |   16.00 |    16.00 |     17.83 |  33.33 |   43.00 |    77.50 |
| Deno/QuickJS     |   37.00 |    36.67 |     37.33 |  49.00 |   47.67 |    46.00 |

PorfforはresetでもKに伴って増加し、keepでは128キーで43.67ms。Node/Denoは約11ms。初期化も含むので3点だけで厳密な漸近計算量を推定しないが、生成Cと方向が一致し、元の「churnでほとんど遅くならない」を一般化できないことは明瞭。

元churnでstableと近くなるのは、削除という高価になり得る操作を増やす一方で、**保持キー数を8からほぼ0へ減らし、探索を安くしている**ため、と考えると説明が通る。異なる効果が相殺しており、比率1.05倍をそのまま「構造変化への耐性」と読むべきではなかった。

## 6. V8: deoptの嵐でも、dictionaryが常に遅いわけでもない

### 6.1 測定中の繰り返しdeoptは観測しなかった

Node用入力を`--trace-opt --trace-deopt`で別実行し、warm-upと測定の境界をログに入れた。reset/drain/keep/named-shapes-16の全てで測定区間のdeopt記録は0。warm-upにはOSR準備を理由とする記録があった。

この診断は別実行で、全測定の全瞬間を証明しない。ただし「deleteのたびにdeoptして再最適化するから、この定常性能になる」という裏付けは得られなかった。**動的操作を残したコードでも、ループや算術等のJIT最適化は有効**であり得る。

Node `--jitless`を対照にすると、resetは17.17対5.00ms、drainは21.60対9.30ms。JITの相対的利益は約3.4倍から約2.3倍へ縮むが、churnでも利益は残る。`--jitless`はcode cacheの切替とは異なる対照である。[V8の説明](https://v8.dev/blog/jitless)

### 6.2 fast propertiesという名称だけでは動的キーの速度を予言できない

Nodeのpre-deleteは4.10msで、fast propertiesを維持するresetの5.00msより速い。Denoも4.45対5.29ms。1回の削除とdictionaryへの移行を追加したにもかかわらず、全体では速くなった。

fast propertiesが得意な「既知の名前から既知のslotへ進む」処理と、8種類の文字列を通る`object[key]`は同じではない。後者では名前解決の残る経路とdictionary lookupのどちらが安いかが問題になる。機械語まで採取していないため細かい寄与率は未確定だが、**dictionary化だけではchurnの遅さを説明できない**ことは対照実験から言える。

fast/dictionaryやHiddenClassの背景は[V8公式解説](https://v8.dev/blog/fast-properties)に沿う。ただし2017年の概説を、今回のバージョン・動的キーの絶対性能順位として使ってはいけない。

### 6.3 NodeとDenoの128キー差も、表現を揃えると消える

128キーのliteralを`%HasFastProperties`で初期状態と200,000更新後に確認した。

| 実行系         | reset開始時→終了時             | reset-128 | pre-delete-128 |
| -------------- | ------------------------------ | --------: | -------------: |
| Node / V8 13.6 | 全256個がfast→fast             |   12.25ms |         4.80ms |
| Deno / V8 15.0 | 全256個がdictionary→dictionary |    4.73ms |         4.69ms |

Nodeに事前削除を入れるとDenoに近い値へ収束する。「Denoというホストだから速い」よりも、**バージョンの異なるV8がこのliteralに異なる表現を選んだ**という説明を強く支持する。どのV8変更が閾値を変えたかまでは調査していない。

Nodeはresetの12.25msよりkeepの11.57msがわずかに短い。操作を増やしたのに速くなり得るのも、構造変更後に別の表現へ移ることを考慮すれば不思議ではない。ただしこの小差の確定より、pre-delete対照の大差を根拠にする。

## 7. 削除をなくしても、AOTはshape多様性の影響を受ける

同じキー集合・値の8キーオブジェクトを、1/4/16種類の挿入順で作る。共有する`.a`を200万回読み、動的キー・削除・欠損値を取り除いた。V8では`%HaveSameMap`で1/4/16種類のMap、全てfast propertiesであることを確認した。他実行系のshape数まで同じと断定するものではない。

| 実行系             | 挿入順1種類 ms | 4種類 ms | 16種類 ms |
| ------------------ | -------------: | -------: | --------: |
| Node               |           1.91 |     4.00 |      6.57 |
| Node `--jitless`   |          37.00 |    40.67 |     56.50 |
| Bun                |           2.45 |     3.61 |      6.08 |
| Deno/V8            |           1.68 |     4.00 |      6.43 |
| Porffor            |           9.18 |    17.00 |     19.00 |
| Static Hermes JS   |          10.20 |    22.80 |    22.60* |
| Perry JS           |          12.38 |    18.00 |    106.00 |
| Perry TS           |          12.33 |    18.00 |    106.00 |
| Deno/QuickJS       |          59.00 |    67.50 |     68.00 |
| scriptc 明示record |           8.58 |     8.67 |      8.67 |
| scriptc 明示Map    |          18.00 |    18.00 |     18.17 |

*Hermes 16種類は5プロセス中22.60, 22.60, 22.60, 22.80, 34.33ms。4→16の悪化率は確定せず、1→複数種類の差を読む。

ここから分かることは三つある。

第一に、**AOTは動的property lookupを消す魔法ではない**。Porfforの生成Cにはnamed access用`object_get_ic`、Hermesにはread property cacheとruntime helper、Perryにはshape照合付きICが残る。機械語への変換が事前でも、実行時にどのobjectが来るか分からないアクセスには判定が必要になる。

第二に、Perryの16種類での急落はdelete/GCだけでは説明できない。このループは読出しのみ。生成IRの`pic.ways`には4つの追加候補照合があり、その後に`js_object_get_field_ic_miss`へのfallbackがある。1/4種類の高速経路と16種類の多様性が噛み合わない、という説明が有力である。主slotやprefix経路もあるため「IC上限は厳密に4」とは断定しない。これはmiss回数を計測した証明ではなく、生成コードと閾値的な悪化の対応。

第三に、scriptcの明示recordはこの条件に強い。[16種類版IR](../build/object-shape-study-2026-09-25/named-shapes-16/scriptc-record/object-stable.ll)では全literalが同じrecord表現へ入り、hot loopは`getelementptr ... i32 1`から`.a`を読む。sourceの挿入順が違っても数値フィールドの位置を揃えられる。**「仮定が崩れても速い」のではなく、「この型契約なら仮定を静的に揃えられる」**という強みである。プロパティ列挙順等を含む一般的なJS意味論への適合性は、この読出し実験では評価していない。

## 8. Perry: 構造変更が、最適化用メタデータの仕事を増やす

Perry JSのdrainは920ms、TSでも163msと、更新本体の小ささに対して非常に大きい。TSのpre-deleteも100msで、reset 12.57msの約8倍になる。逆にundefined代入は両者ともresetと同程度。単にunion値を扱うからではなく、**構造が変わったobjectのアクセス経路**を疑うのが妥当。

通常のPerry実行ファイルはsymbolがstripされていたため、測定バイナリを残し、同じ入力を`PERRY_KEEP_SYMBOLS=1`で別出力へ再コンパイルして2秒samplingした。これは時間比較には使っていない。

- [JS stable](../build/object-shape-study-2026-09-25/perry-symbols-stable.sample.txt)では、`js_dyn_index_get`、既存own property上書きの`try_existing_own_data_overwrite`等が見える。
- [JS churn](../build/object-shape-study-2026-09-25/perry-symbols-churn.sample.txt)では、`js_put_value_set → ordinary_set_with_receiver → target_set → set_object_keys_array → publish_object_shape_from`のstack、その下の`try_update_stable_tombstone_shape`やreverse index更新が見える。読出し側にはキー探索・prototype側の処理、加えて`layout_addr_filter_rebuild`やminor GCも現れる。
- [TS churn](../build/object-shape-study-2026-09-25/perry-ts-symbols-churn.sample.txt)にも、`js_put_value_set_dyn_ic_miss`、`shape_descriptor_by_id`、`keys_find_slot_by_bytes`、`shape_descriptor_ensure_with_holes`等が現れる。

重要なのはアプリの演算自体ではなく、**高速アクセスや正しいGCを支えるshape・slot・layout情報を保つ処理が、構造変更によって仕事になっている**こと。元の「AOTなら動的最適化の負担が少ないのでは」という期待とは逆に、AOT runtimeも高速経路を維持する仕組みを持ち、その更新が高価になり得る。

ただし2秒の別ビルドsamplingから「遅さの何%がGC」「特定tableがO(N²)」とまでは言えない。旧process 432.6ms対旧in-process 900.9msの差も、継続実行中のruntime状態とwrapperのコード生成を分離できていない。今回は**一般的なGCの推測より具体的なhot pathと、deleteなしでも起きる多様性の限界**まで確認した。

## 9. `delete`未計測の理由: 文法・型契約・コード生成を区別する

「scriptc/shermesはdelete未対応」で一括りにするのは不正確。追試では次の違いが出た。

| 入力・実行系                      | 確認した挙動                                                                 | 解釈                                               |
| --------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| scriptc JS推論record / 明示record | 必須field削除をruntimeまたはcompileで拒否                                    | 固定record表現の制約                               |
| scriptc 数値Map                   | 単純delete後のキー数は正しいが、代入→delete→読出しでtyped-slotエラー         | 削除関数はある。欠損と数値型アクセスの整合が別問題 |
| scriptc `number \| undefined` Map | 単純delete検査は通るが、代入→delete→ローカル読出しは0、期待1                 | optionalにするだけでも解決しない                   |
| Hermes JS                         | 厳密delete検査とchurnを通過                                                  | 削除そのものは対応                                 |
| Hermes 数値indexer                | `number`と`void`の比較を拒否する例。旧workloadでは削除後のchecked castで失敗 | 欠損を許さない型契約とアクセスの不整合             |
| Hermes `number \| void` indexer   | 代入→delete→読出し、キー数検査、churnを通過                                  | 欠損を表せる契約なら実行できる経路がある           |

scriptcのoptional版は特に重要。[drainのIR](../build/object-shape-study-2026-09-25/drain-8/scriptc-optional/object-stable.ll)では、`scr_map_delete_str`の後のmissをunionのundefined値へする処理があるのに、その値を`scr_union_get_f64`で数値として取り出し、`after === undefined`を`br i1 false`へ畳み込んでいる。結果は期待102387360に対して102187360で、欠損確認200,000回分が丸ごと欠ける。

```js
// objectsの要素型を {[key: string]: number | undefined} にしても再現
const key = keys[0];
object[key] = 7;
delete object[key];
const after = object[key];
console.log(after === undefined ? 1 : 0); // scriptc: 0、期待: 1
```

代入による数値型推論をdeleteが無効化していないように見える。これはIRと最小再現からの推論で、コンパイラ内部の原因passは未調査。しかし「Mapにundefinedを格納できないだけ」という旧説明より深い問題である。この誤った高速実行は性能表から除外した。

Hermes Flowは`number | void`にし、数値加算に`Number(current)`を使うとreset 17.83、drain 30.25、keep 34.33msでchecksumが一致した。単純な`!== undefined`によるnarrowingや直接number castでは今回のcompilerが受理しないため明示変換を使った。変換の仕事を含む別入力なのでJS版との完全同一比較ではないが、**shermesがdelete命令を持たないという仮説は否定できる**。

`in`を含む複合probeはscriptcのindexer MapやHermesのtyped objectでcompile不可だったため、欠損読出しと`Object.keys`も個別に調べた。compile不可をdelete自体の失敗と取り違えないためである。

## 10. 各実行系をどう捉えるか

| 実行系         | 今回見えた得意条件                                                            | 崩れる条件・注意点                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Node / Deno V8 | warm-up後のループ、固定named access。dictionary定常更新も強い                 | キーの多様性・表現選択に依存。V8バージョンを揃えずホスト差と呼ばない                                                                       |
| Bun            | resetの2.6ms級。128キーでも約2.9ms。16種類named accessでも今回のJIT群では速い | deleteの繰返しで12〜16.5ms。128キーpre-deleteも8.67msと遅く、構造変更履歴に敏感。JSC内部の直接traceは未取得なのでdeopt等の機構を断定しない |
| Porffor        | 小さい動的object、特に0/1キー。元process測定では起動込みの小ささも効く        | 線形探索・詰め直しが大きいKで不利。named accessの多様性にも影響される                                                                      |
| scriptc        | 明示recordの固定named access、動的キー向けの明示Map                           | JS推論境界の全配列変換と参照破綻。delete後の型推論・欠損処理にも問題。正しさと生成表現の確認が先                                           |
| Perry          | 構造が安定したtyped入力でJS入力より速い場面                                   | 構造変更後の汎用経路とメタデータ更新、多種類named accessのfallbackが高価。型注釈だけでは解消しない                                         |
| Static Hermes  | JSでdeleteの意味論を維持。型契約を直せばFlowでもchurnが動く                   | helper/cacheを持つ動的runtimeで、shape非依存ではない。keepのK増加で大きく悪化                                                              |
| Deno/QuickJS   | 今回のキー数増加に対し絶対時間が比較的平坦                                    | reset自体が約37msなので低いchurn倍率を高throughputと取り違えない。named多様性にも小さいが差がある                                          |

たとえば「QuickJSはchurn倍率が低い」は、安定時の高速化による利益が小さい場合にも起きる。同様に「Bunは4.7倍悪化」はstableが非常に速いことも反映する。**相対悪化率と、利用者が待つ絶対時間は別の指標**である。

## 11. 元の仮説への答えと残した問い

AOTがJITを上回る領域はある。ただし今回の主な説明は「JITが毎回最適化を失敗する」ではなく、**特定の小さいobjectに対するPorfforの低コストな実装**だった。保持キー数を増やしたり、objectを空にしない条件へ変えると優位は消える。削除を除いてshape多様性だけを増やしても、今回のJIT群は多くのAOTより絶対時間が短かった。

一方、型から固定layoutを与えられるAOTには、挿入順を吸収して一定のアクセスコストにできる可能性がある。scriptcの明示recordがその例。ただしJSの動的意味論をどこまで維持できるか、境界の変換がどれだけ高価かは同時に検査しなければならない。

証拠の強さには差がある。scriptcの全配列変換は**IR・計算量の対照・固定キー対照・profile・参照probe**が揃う。Porfforのcardinality依存とV8の表現選択も対照で裏付けた。Perryの各metadata処理の寄与率、Hermes/Bunの詳細な経路、長時間のGC状態までは同じ強さで特定できていない。

残る有用な追試は、(1) allocation数・GC回数を揃えたPerryの長時間profile、(2) JSCの構造変更時の経路追跡、(3) 初期化を分離したpersistent-object版、(4) seed付きランダム順序・prototypeを変えた欠損lookup対照である。それまでは今回の有限キー・決定的順序の結果を任意の動的JSへ外挿しない。

**評価単位にすべきなのは「AOT/JIT」ではなく、「型契約 × object表現 × アクセスの多様性 × 構造変更の頻度 × 意味論の正しさ」である。** 今回は順位の再確認から、この各軸のうちどれが効いているかを反証可能な形まで絞り込めた。
