# デモ 2: Mean Filter — 開いているシリーズに平均化フィルタをかける

2D ビューアで開いているシリーズの**生の画素（CT なら HU）**に **k×k の平均化（ボックス）
フィルタ**をかけ、**before / after を並べて表示**するプラグインです。結果はビューアへ重ねたり、
**派生シリーズとして保存**したりできます。ビルドツールは不要です。

学べること:

1. `ui.js` はレンダラのフルコンテキストで動く（`document` も `fetch` も使える）
2. **開いているシリーズを知る**（`host.getTargets()`）
3. **生の画素を読む**（`host.getPixelData()`。W/L 適用前の定量値）
4. **結果を見せる・残す**（`host.showOverlay()` / `host.saveDerivedSeries()`）
5. **自前のダイアログ**を DOM で組み立てる
6. 画素処理そのものは素の JS（分離可能ボックスフィルタで O(w·h)）

- 対象: [GRAPHY-Next](https://github.com/tatsunidas/GRAPHY-Next) **v0.1.9 以降**
  （`getTargets` / `getPixelData` / `showOverlay` / `saveDerivedSeries` が入った版）
- 動作モード: **デスクトップ版・Web 版の両方**（UI のみのプラグインなので）
- 姉妹デモ: [デモ集ハブ](https://github.com/tatsunidas/graphy-next-plugin-demos) ／
  [デモ 1: Hello](https://github.com/tatsunidas/graphy-next-plugin-hello) ／
  [デモ 3: Gemini 所見推敲](https://github.com/tatsunidas/graphy-next-plugin-gemini-findings)

> **v0.1.9 で変わった点**: 以前のこのデモは、開いているシリーズを DOM（`data-tile-id`）から探し、
> 画素を**表示中のキャンバス**（W/L 適用後の 8bit）から読んでいました。v0.1.9 で
> `getTargets()` / `getPixelData()` / `showOverlay()` / `saveDerivedSeries()` が入ったので、
> **DOM 依存は無くなり、フィルタは HU に対する定量処理**になりました。詳しくは §6。

> このリポジトリの README は**単体で完結**するように書いてあります。
> 他のデモの README と内容が重複していますが、そういう方針です。

---

## 目次

1. [5 分で動かす](#1-5-分で動かす)
2. [ファイルの中身](#2-ファイルの中身)
3. [`plugin.json` の全フィールド](#3-pluginjson-の全フィールド)
4. [`ui.js` と `host` API](#4-uijs-と-host-api)
5. [コード解説](#5-コード解説)
6. [なぜ生の画素なのか](#6-なぜ生の画素なのか)
7. [リリースする（GitHub Release）](#7-リリースするgithub-release)
8. [GRAPHY-Next に入れる（デスクトップ版）](#8-graphy-next-に入れるデスクトップ版)
9. [Web 版に載せる](#9-web-版に載せる)
10. [鍵方式（署名）](#10-鍵方式署名)
11. [うまくいかないとき](#11-うまくいかないとき)
12. [できないこと（正直に）](#12-できないこと正直に)

---

## 1. 5 分で動かす

いちばん速いのは、**プラグイン格納ディレクトリに手で置く**方法です。リリースも導入 UI も要りません。

### 1-1. 格納ディレクトリを開く

| OS | 場所 |
|---|---|
| Windows | `%APPDATA%\GRAPHY-Next\plugins\` （実体は `C:\Users\<ユーザー名>\AppData\Roaming\GRAPHY-Next\plugins\`） |
| macOS | `~/Library/Application Support/GRAPHY-Next/plugins/` |
| Linux (AppImage) | `~/.config/GRAPHY-Next/plugins/` |

> **インストール先ではなく、OS のユーザーデータ領域**です。本体が読み取り専用（AppImage など）でも
> 書けること、アンインストーラがユーザーデータを巻き添えで消さずに済むことが理由です。
> 場所はアプリの **ヘルプ ＞ アンインストール** ダイアログにも表示されます。

### 1-2. ファイルを置く

```
<plugins>/
└── mean-filter/
    ├── plugin.json
    └── ui.js
```

### 1-3. 使う

1. GRAPHY-Next を**完全に終了してから起動**する
2. データベース画面からシリーズを開き、2D ビューアに表示する
3. 2D ビューアの **Plug-ins ＞ Mean Filter（平均化フィルタ）** をクリック
4. ダイアログが開き、元画像と平均化後が並ぶ。カーネルを変えて「実行」で再計算

> **反映のルール（重要）**
>
> | 変更した中身 | 必要な操作 | 理由 |
> |---|---|---|
> | `ui.js` だけ | 画面のリロード | フロントは起動時に `/api/plugins` を読んで動的 import するため |
> | `*.jar` を含む | **アプリの再起動** | クラスローダを id 単位でキャッシュしており、同 id の JAR 差し替えを拾わないため |
>
> マニフェスト一覧はアクセスのたびにディレクトリを走査するので backend の再起動自体は不要ですが、
> パッケージ版にはリロード用の UI 操作がありません。**実務上はアプリを終了→再起動**が確実です。

---

## 2. ファイルの中身

```
plugin.json                     ← 必須。マニフェスト
ui.js                           ← 画面側（ES モジュール・ビルド不要）
graphy-plugin.d.ts              ← エディタ補完用（配布物には含めない）
.github/workflows/release.yml   ← タグ push で zip + sha256 (+ 署名) を作る
LICENSE
```

**1 プラグイン = 1 フォルダ**です。フォルダ直下に `plugin.json`（必須）、
任意で `ui.js`（画面側）と `*.jar`（Java 側）を置きます。それだけです。

---

## 3. `plugin.json` の全フィールド

このデモの `plugin.json`:

```json
{
  "id": "mean-filter",
  "name": "Mean Filter（平均化フィルタ）",
  "version": "0.1.0",
  "contributes": ["viewer2d.menu"],
  "ui": "ui.js",
  "engines": { "graphy": ">=0.1.8", "os": ["win32", "darwin", "linux"] },
  "permissions": ["read-pixels"],
  "description": "…", "author": "…", "homepage": "…", "license": "MIT"
}
```

| キー | 必須 | 説明 |
|---|---|---|
| `id` | ✅ | 一意な ID（`[A-Za-z0-9._-]`）。フォルダ名と揃えると分かりやすい |
| `name` | ✅ | メニューに出る表示名 |
| `version` | ✅ | semver。**リリースタグ `v<version>` と一致必須** |
| `contributes` | UI を出すなら | 出す先（サーフェス）の配列 |
| `ui` | UI を出すなら | フォルダ直下の ES モジュール名 |
| `entrypoint` | JAR を持つなら | `GraphyPlugin` 実装クラスの完全修飾名（このデモは無し） |
| `permissions` | 任意 | 要求権限。**宣言のみで、現状は強制されない** |
| `engines.graphy` | 推奨 | 対応する本体の版の範囲 |
| `engines.os` | 推奨 | 対応 OS |
| `description` / `author` / `homepage` / `license` | 任意 | 一覧・同意画面の表示用 |

### サーフェス（`contributes`）— どこに出るか

| 値 | 出る場所 | 用途 |
|---|---|---|
| `viewer2d.menu` | 2D ビューアの **Plug-ins** メニュー | 表示中の画像に対する処理・ツール |
| `mainscreen.menu` | データベース画面の **Plug-Ins** メニュー | DB・エクスポート等、画像に依存しない機能 |
| `viewer2d.toolbar` | （予約） | ツールバーへの常設ボタン。描画は将来 |

このデモは表示中の画像を対象にするので `viewer2d.menu` だけを宣言しています。

### `permissions` は宣言であって強制ではない

`"read-pixels"` と書いてありますが、**現状これは同意画面に表示されるだけで、実際のアクセスは
制限されていません。** 書く意味は「利用者に意図を伝える」ことにあります。

### `engines` — 入れる前に弾くための宣言

- **`engines.graphy`**: 本体の版と照合します。演算子は `>= <= > < =` と空白 AND（`">=0.1.8 <0.3.0"`）。
  `*` / 空 / 未指定は常に互換。本体が開発ビルド（`"dev"`）のときはゲートしません。
- **`engines.os`**: `win32` / `darwin` / `linux`。**非対応と判定されると、ユーザーが同意しても
  展開前に拒否されます**（fail-closed）。このデモは純 JS なので 3 つとも書いています。

---

## 4. `ui.js` と `host` API

`ui.js` は **ES モジュール**です。バンドラは不要で、backend が `text/javascript` として配信し、
フロントが動的 `import()` で読み込みます。メニューがクリックされると `activate(host)` が呼ばれます。

```js
export function activate(host) { /* … */ }
// export default { activate }; でも可
```

`activate` は `Promise` を返してもかまいません（このデモは `async function` です）。

### `host` に入っているもの

**すべてのサーフェス共通**

| プロパティ | 型 | 説明 |
|---|---|---|
| `surface` | `string` | 呼び出し元（`"viewer2d.menu"` / `"mainscreen.menu"` …） |
| `pluginId` | `string` | 自分の `plugin.json` の `id` |
| `t(key)` | `(k: string) => string` | ホストの i18n 取得関数（アプリの言語に追従） |
| `notify(msg)` | `(m: string) => void` | ユーザーへの簡易通知 |
| `runBackend(payload?)` | `(p?: unknown) => Promise<unknown>` | `POST /api/plugins/{id}/run` を呼ぶ（JAR がある場合） |

**`viewer2d.menu` / `viewer2d.toolbar` のとき追加**

| プロパティ | 説明 |
|---|---|
| `actions` | 表示中タイルへの操作。`fit()` / `reset()` / `rotate90()` / `flipH()` / `flipV()` / `invert()` / `undo()` / `redo()` / `setWindowLevel(center, width)` / `resetWindow()` ほか |
| `getTargets()` | **v0.1.9 以降**。操作対象タイル（選択→無ければ全）の配列。要素は `{ tileId, studyUid, seriesUid, seriesLabel, imageId, sliceIndex, sliceCount, c, t, modality }` |
| `getViewState(tileId?)` | **v0.1.9 以降**。`{ windowCenter, windowWidth, unit, colormap, invert, flipH, flipV, rotation, zoom, pan }`。W/L はモダリティ値空間（CT なら HU） |
| `getPixelData(tileId?, opts?)` | **v0.1.9 以降**。`Promise<{ rows, cols, data: Float32Array, unit, spacing, sliceIndex, imageId, tileId }>`。**W/L 適用前の定量値**。`opts.sliceIndex` で別スライス |
| `showOverlay(tileId?, overlay)` | **v0.1.9 以降**。値マップを表示中スライスに重ねる。`NaN` は透明。色付け（`window` / `colormap` / `opacity`）は本体がする |
| `clearOverlay(tileId?)` | **v0.1.9 以降**。重ねたものを消す |
| `saveDerivedSeries(tileId?, req)` | **v0.1.9 以降**。結果を派生シリーズとして保存。**本体が必ず確認ダイアログを出す**（拒否されると `{ ok: false, cancelled: true }`） |

> `getTargets()` / `getViewState()` / `getPixelData()` は**呼ぶたびに現在値を読みます**。
> ダイアログを開いている間にユーザーがスライスを送るので、`activate` 時の値を持ち回らないこと
> （このデモも「実行」を押すたびに `getTargets()` を読み直しています）。

**`mainscreen.menu` のとき追加**

| プロパティ | 説明 |
|---|---|
| `selectedStudyUid` | 選択中スタディの UID（未選択なら `null`） |

### 型補完（ビルド不要）

同梱の `graphy-plugin.d.ts` をプラグインフォルダに置き、`ui.js` の先頭に次の 2 行を書くと、
TypeScript を導入しなくても VS Code で `host` に補完が効きます。

```js
/// <reference path="./graphy-plugin.d.ts" />
// @ts-check
```

`.d.ts` は**配布物（zip）には入れません**（エディタ用なので）。

---

## 5. コード解説

### 5-1. 開いているシリーズを知る

```js
const targets = host.getTargets();
// [{ tileId, studyUid, seriesUid, seriesLabel, imageId, sliceIndex, sliceCount, c, t, modality }, …]
```

対象は「選択タイル → 無ければ全タイル」（`actions` の各コマンドと同じ定義）。
シリーズ名・モダリティ・スライス位置まで入っているので、**REST を自分で叩く必要はありません**。

> **毎回読み直すこと。** `getTargets()` は呼んだ時点の現在値を返します。ダイアログを開いている間に
> ユーザーがスライスを送るので、`activate` 時の配列を持ち回ると「古いスライスに対する結果」を
> 出してしまいます。このデモは「実行」を押すたびに読み直しています。

> v0.1.8 以前は DOM の `data-tile-id` 属性を読んでいました（非公式・本体の版で壊れうる）。
> v0.1.9 以降は不要です。

### 5-2. 生の画素を読む

```js
const px = await host.getPixelData(target.tileId);
// { rows, cols, data: Float32Array, unit, spacing, sliceIndex, imageId, tileId }
const v = px.data[y * px.cols + x];   // CT なら HU
```

- **W/L 適用前の定量値**です（W/L や LUT を変えても値は変わりません）。単位は `unit`（CT は `"HU"`）。
- `spacing` は `[列方向(x), 行方向(y), スライス方向(z)]` mm。物理サイズが要る処理に使えます。
- **1 回 1 スライス**。別スライスは `getPixelData(tileId, { sliceIndex })`。範囲外は `null`
  （末尾へ丸められたりしません）。
- 画素を読むプラグインは `plugin.json` の `permissions` に `"read-pixels"` を宣言します
  （導入時の同意画面に出ます。現状これは宣言であって強制ではありません）。

### 5-3. 平均化フィルタ（分離可能ボックスフィルタ）

2 次元のボックスフィルタは「**横方向の移動平均 → 縦方向の移動平均**」に分解できます。
素朴な二重ループは O(w·h·k²) ですが、こうすると **O(w·h)**（カーネルサイズに依存しない）で済みます。

```js
// 横方向: ウィンドウを 1 画素ずらすたびに、出ていく画素を引き、入ってくる画素を足す
let sum = 0;
for (let d = -r; d <= r; d++) sum += src[y * w + clamp(d, 0, w - 1)];
for (let x = 0; x < w; x++) {
  tmp[y * w + x] = sum / k;
  sum += src[y * w + clamp(x + r + 1, 0, w - 1)]
       - src[y * w + clamp(x - r,     0, w - 1)];
}
```

- 入力は**単チャンネルの実数**（`Float32Array`）なので、RGBA の 4 要素飛ばしが要りません。
- 端は最外画素を繰り返す（clamp）扱い。

### 5-4. プレビューを焼く

画素は定量値なので、見せるときは自分で W/L を掛けて 8bit にします。ビューアと同じ見え方に
したいので、W/L は `host.getViewState()` から借ります。

```js
const view = host.getViewState(target.tileId);
const lower = view.windowCenter - view.windowWidth / 2;
const g = clamp(Math.round((value - lower) * (255 / view.windowWidth)), 0, 255);
```

### 5-5. 結果をビューアへ重ねる

```js
host.showOverlay(target.tileId, {
  data: filtered, rows: px.rows, cols: px.cols,
  window: { center: view.windowCenter, width: view.windowWidth }, opacity: 1,
});
```

**渡すのは値だけ**で、色付け（`window` / `colormap` / `opacity`）は本体がします。
`NaN` の画素は**透明**になるので、マスクや部分的なマップをそのまま渡せます。
`rows`/`cols` は現在スライスと一致していること（不一致なら `false` が返ります）。
オーバーレイは**出したスライスに紐付き**、他スライスでは自動的に隠れます。

### 5-6. 結果を派生シリーズとして保存する

```js
const res = await host.saveDerivedSeries(target.tileId, {
  seriesDescription: `Mean ${k}x${k}`,
  derivationDescription: `Mean filter ${k}x${k} (separable box)`,
  frames: [{ sliceIndex: px.sliceIndex, data: filtered }],
  rows: px.rows, cols: px.cols, unit: px.unit,
});
```

- **本体が必ず確認ダイアログを出します**（抑止不可）。拒否されると `{ ok: false, cancelled: true }`。
  プラグインが黙って保管庫に書くことはできません。
- **幾何はプラグインが書きません。** `frames` は「元シリーズのどのスライスに対応するか」
  （`sliceIndex`）だけを申告し、位置・向き・画素間隔・スライス厚は本体が元シリーズから引き継ぎます。
- 画素は 16bit ＋ Rescale で保存されます。**HU のような整数はそのまま**、確率マップのような
  小さい実数は値域から係数を決めて量子化されます。`NaN` は「データ無し」として値域の最小値に。
- 保存物には `SeriesDescription` の **`[Plugin] ` 接頭辞**とプラグイン id・版が必ず残ります。
  **元シリーズは変更されません**（新しいシリーズが 1 本増えるだけ）。

### 5-7. 自前のダイアログ

`ui.js` はレンダラのフルコンテキストで動くので、`document.createElement` で普通に DOM を組めます。
外部 CSS ファイルは配信されないため、見た目は **inline style** で付けています
（CSP は `style-src 'self' 'unsafe-inline'` なので `element.style.x = …` は問題ありません）。

### 5-8. （参考）backend の REST を叩きたいとき

このデモでは不要になりましたが、backend の API を叩きたい場合はオリジンを
`import.meta.url` から得るのが確実です。`ui.js` は `/api/plugins/<id>/ui.js` として backend から
配信されるので、**自分自身の URL のオリジンがそのまま backend のオリジン**です
（デスクトップ版は `file://` から起動し backend は動的ポートなので、`window.location` では分かりません）。

```js
const API_ORIGIN = new URL(import.meta.url).origin;
```

**外部サイトへは接続できません。** 配布版のレンダラには
`connect-src 'self' http://localhost:* http://127.0.0.1:*` の CSP が効いており、
`ui.js` から外部 API を `fetch` すると**ブロックされます**。外部 API を叩きたい場合は
バックエンド面（JAR）から呼びます（[デモ 3](https://github.com/tatsunidas/graphy-next-plugin-gemini-findings) 参照）。

---

## 6. なぜ生の画素なのか

平均化フィルタは「値」に対する処理です。表示中のキャンバス（W/L 適用後の 8bit）を平滑化すると、
**見た目の平滑化**にはなりますが、W/L の外に飛び出した値（骨も空気も飽和して同じ白／黒）は
すでに情報が落ちているので、**HU に対する定量処理にはなりません**。

`host.getPixelData()` が返すのは `pixelCalibration` を通した**モダリティ値**です。

| | 旧（〜v0.1.8） | 新（v0.1.9 以降） |
|---|---|---|
| 対象タイルの特定 | DOM の `data-tile-id`（非公式・壊れやすい） | `getTargets()` |
| 画素 | 表示中キャンバスの 8bit RGBA（W/L 適用後） | `getPixelData()` の `Float32Array`（CT なら HU） |
| シリーズ名・モダリティ | REST を自分で叩く | `getTargets()` が返す |
| 結果の表示 | 自前ダイアログのみ | 自前ダイアログ ＋ `showOverlay()` でビューアに重ねる |
| 結果の保存 | ❌ | `saveDerivedSeries()`（本体が確認ダイアログを出す） |

**W/L や LUT を変えても `getPixelData()` の値は変わりません**（表示の設定に依存しない）。
このデモが before / after で出している min / max / mean は、その定量値の統計です。

### まだできないこと

- **全スライスの一括処理**は「1 回 1 スライス」の API を回す形になります
  （`getPixelData(tileId, { sliceIndex })` を繰り返す）。このデモは表示中の 1 スライスだけを扱います。
  512×512×500 を Float32 で一度に持つと 500MB を超えるので、必要な範囲だけ読む設計にしてください。
- **カラー画像**（RGB）は輝度に落ちて `unit === "raw"` になります。

---

## 7. リリースする（GitHub Release）

配布は **GitHub Release の「ビルド済み zip 資産」**で行います。ソース tarball ではありません
（`ui.js` はトランスパイル後、`*.jar` はコンパイル後の成果物が要るため）。

### 7-1. リリース資産

| 資産 | 内容 | 必須か |
|---|---|---|
| `<id>-<version>.zip` | **直下に `plugin.json`** ＋ 任意 `ui.js` / `*.jar` | ✅ 必須 |
| `<id>-<version>.zip.sha256` | 完全性検証用 | 実質必須（無いと既定で導入拒否） |
| `<id>-<version>.zip.minisig` | 署名（真正性） | 推奨（§10） |
| `minisign.pub` | 署名の公開鍵 | 署名するなら必要 |

このデモなら `mean-filter-0.1.0.zip` の直下に `plugin.json` と `ui.js` が入ります。

### 7-2. タグを push するだけ

同梱の [`.github/workflows/release.yml`](.github/workflows/release.yml) が、
タグ `v<version>` の push で zip・sha256・（鍵があれば）署名まで作って Release に添付します。

```bash
# plugin.json の version を 0.2.0 に上げてコミットしてから
git tag v0.2.0
git push origin v0.2.0
```

**`plugin.json` の `version` とタグは一致必須**です。ずれていると CI がエラーで落ちます。

---

## 8. GRAPHY-Next に入れる（デスクトップ版）

### 8-1. 導入を許可する（初回だけ）

導入操作は **3 つの条件がすべて揃ったときだけ**許可されます。既定では 3 番目が OFF です。

| # | 条件 | 誰が決めるか | 既定 |
|---|---|---|---|
| 1 | デスクトップ版（standalone）であること | モード | Web は常に `403` |
| 2 | `graphy.plugins.manager-enabled` | 管理者（yml） | `true`（施設で一律禁止したい場合に `false`） |
| 3 | 設定キー `plugins.installEnabled` | **ユーザー** | **`false`** |

**環境設定 ＞ プラグイン ＞「プラグインの導入を許可する」を ON** にしてください。

> 分けてある理由: プラグインはアプリと同じ権限で動きます。「環境として許すか（管理者）」と
> 「今それを使うか（ユーザー）」は別の判断なので、2 段にしてあります。
> トグルを OFF に戻しても**導入済みプラグインは動き続けます**（止めたいなら個別に無効化）。

### 8-2. GitHub から入れる

環境設定 ＞ プラグイン で `tatsunidas/graphy-next-plugin-mean-filter` と入れて「GitHub から導入」。
内部では次が起きます。

```
[1] ゲート判定        standalone か / 管理者ゲート / ユーザーのオプトイン
      │ 欠ければ 403（閲覧のみ）
      ▼
[2] 取得              Release から <id>-<ver>.zip ＋ .sha256 ＋ .minisig / minisign.pub
      │ ※ まだ展開していない
      ▼
[3] 検査 (inspect)    zip を展開せずに読み、中身を提示用データにする
      │
      ├─ 署名が既知の鍵で通った ─────────► [5] へ直行（確認画面なし＝押すだけ）
      │
      └─ 未署名 / 未知の鍵 / 警告あり
      ▼
[4] 同意画面          何を受け入れるのかを提示して承諾を得る
      │ 互換NGなら同意しても導入できない
      ▼
[5] 導入 (install)    再取得 → 同意した sha256 と一致するか確認 → 展開 → 台帳に記録
      ▼
[6] 反映              UI のみ → 画面リロード ／ JAR 入り → アプリ再起動
```

同意画面には次が出ます。**同梱 JAR の一覧は「アプリと同じ権限で動くコードの有無」**なので、必ず見てください。
このデモは JAR を含まないので、そこは空になります。

- id / name / version / 説明 / 作者 / ライセンス
- **同梱 JAR の一覧**、`ui.js` の有無、ファイル数・総サイズ
- 宣言 `permissions`（このデモは `read-pixels`）
- 対応 OS の突き合わせ結果、コア版数の互換
- `sha256` と検証状態、署名の状態
- 同じ id が既に入っているか

**[5] の「同意した sha256 と一致するか確認」**は TOCTOU 対策です。同意画面を見てから導入するまでの間に
リリース資産が差し替えられても、**ユーザーが見ていない成果物は入りません**。

### 8-3. ローカル zip から入れる（オフライン / 開発中）

同じ画面から zip ファイルを直接指定できます（エアギャップ環境向け）。
なお、**file 由来のものは「再インストール」ができません**（zip を保持しないため、再アップロードが必要）。

### 8-4. 台帳

`<plugins>/installed.json` に、取得元・sha256・署名鍵・同梱 JAR 名・有効無効が記録されます。

---

## 9. Web 版に載せる

**Web 版ではエンドユーザーによる導入はできません。** 一覧の閲覧のみで、導入系 API は `403` です。

| | デスクトップ（standalone） | Web |
|---|---|---|
| 導入操作 | ✅ 環境設定 ＞ プラグイン | ❌ `403`（閲覧のみ） |
| 追加方法 | ユーザーが GitHub / ローカル zip から | **運営がイメージに焼き込む** |
| JAR の実行 | ✅ 同一 JVM | ❌ `501`（サンドボックス未実装） |
| UI のみ | ✅ | ✅（運営配備分のみ） |

理由は backend が**共有サーバー**だからです。任意の JAR を共有 JVM に読ませると、そのコードは
サーバー権限で全実行でき、**他患者データの読み取りや他テナント侵害**まで届きます。

### 運営が Web 版へ載せる手順

デモ環境（`deploy/demo/`）のコンテナは `read_only: true` で、`/app/plugins` はボリュームマウント
されていません。したがって**稼働中に書き込む手段がありません**。追加は次のようになります。

1. プラグインのフォルダをデプロイ用ディレクトリに置く
2. `Dockerfile` に `COPY <plugin-dir> /app/plugins/<id>` を追加
3. イメージをビルドして再デプロイ

つまり **Web 版へのプラグイン追加は、コード変更・再デプロイ扱い**です。

**このデモは UI のみなので Web 版でも動きます。** ただしシリーズ情報の取得（§5-3）は
公開デモの API 制限で失敗することがあります（その場合も UID 表示にフォールバックします）。

---

## 10. 鍵方式（署名）

### 10-1. なぜ必要か — sha256 だけでは足りない

導入時の検証は **4 段**あり、それぞれ守っている性質が違います。ここを混同しないことが重要です。

| 段 | 何を見るか | 守れる性質 | 失敗したら |
|---|---|---|---|
| A | zip の構造・`id`・展開先 | **安全な展開**（zip slip / 巨大 zip / パス脱出） | `422` で拒否 |
| B | `engines.os` / `engines.graphy` | **動く環境か** | 展開前に `422`（同意しても不可） |
| C | `<zip>.sha256` | **完全性**（転送中の破損・部分的な差し替え） | 既定で拒否。明示承諾時のみ通す |
| D | `.minisig`（Ed25519 署名） | **真正性**（誰が作ったか・乗っ取り検知） | **無条件で拒否** |

**sha256 は同じリリースから取ってきます。** リポジトリを支配した側は zip とハッシュを両方
差し替えられるので、これは「壊れていないこと」しか保証しません。**誰が作ったかは分かりません。**
そこに答えるのが署名です。

### 10-2. 仕組み — minisign（Ed25519）と TOFU

GRAPHY-Next は [minisign](https://jedisct1.github.io/minisign/) 形式の署名を検証します。
検証に使う鍵は次の順で探します。

| 順 | 鍵の出どころ | 状態 | 挙動 |
|---|---|---|---|
| ① | 本体設定 `trusted-keys`（GRAPHY-Next 公式配布鍵） | `trusted` | **確認画面なしで導入** |
| ② | 台帳に固定した前回の鍵 | `pinned` | **確認画面なしで導入** |
| ③ | リリース同梱の `minisign.pub`（初回のみ） | `first-use` | 確認画面を出し、導入時にこの鍵を固定 |
| — | 検証失敗・鍵 ID 不一致・**署名の剥がし** | `invalid` | **拒否**（承知しても通さない） |

②が **TOFU（trust on first use）** の核心です。初回に見た鍵を台帳に固定し、更新時は
**リリースが同梱してくる鍵ではなく、固定した鍵で**検証します。これにより
**リポジトリ乗っ取りや作者すり替えは、更新の時点で自動的に弾けます。**

「署名を剥がして未署名として出す」抜け道も塞いであります（固定鍵がある id の未署名パッケージは
`invalid` 扱い）。その代わり、**配布者にとって署名は片道の約束**になります。

> **利用者は鍵を一切扱いません。** 鍵の生成・保管は配布者、公式鍵の同梱は本体の仕事で、
> 利用者から見れば「署名されているものは押すだけで入る」だけです。

### 10-3. 作者としてやること（1 回だけ）

```bash
# 1. 鍵を作る。パスフレーズは必ず設定する（空にしない）
minisign -G -p minisign.pub -s minisign.key

# 2. 公開鍵はリポジトリにコミットしてよい（秘密ではない）
git add minisign.pub && git commit -m "add signing public key" && git push

# 3. 秘密鍵とパスフレーズを GitHub の secrets に登録する
gh secret set MINISIGN_SECRET_KEY < minisign.key
gh secret set MINISIGN_PASSWORD     # プロンプトでパスフレーズを入力
```

これだけです。以降、リリースごとの追加作業はありません
（同梱の `release.yml` が署名します。secrets が未登録なら署名ステップは自動でスキップされます）。

**`minisign` の入手**: Ubuntu 22.04 / Pop!\_OS のリポジトリには**ありません**。
[公式のスタティックバイナリ](https://github.com/jedisct1/minisign/releases)を `/usr/local/bin` 等に置いてください。
macOS は `brew install minisign`、Windows は `scoop install minisign` などが使えます。

### 10-4. 秘密鍵の保管がすべて

技術的には Ed25519 の鍵に**有効期限はありません**。失効リストも OCSP も無く、
X.509 証明書のように「期限切れで一斉に動かなくなる」ことは起きません。
鍵の寿命を決めるのは運用だけです。

| 事象 | 起きること | 復旧 |
|---|---|---|
| 秘密鍵を**紛失** | 以後の更新に署名できない。既存利用者は「前回は署名付き＝今回未署名」で**更新を拒否**される | 利用者側でアンインストール→再導入が必要（＝全利用者に影響） |
| 秘密鍵が**漏洩** | 攻撃者が正規の署名を作れる。TOFU も突破される | 鍵のローテーション＋告知 |
| 鍵を**変更**（意図的） | 利用者は「前回と違う鍵」として更新を拒否する | アンインストール→再導入を案内する |

**やること**: オフラインのバックアップを 2 か所（暗号化 USB ＋ パスワードマネージャのセキュアノート等）。
パスフレーズは鍵ファイルと**別の場所**に保管。

**やってはいけないこと**:

- 秘密鍵をリポジトリにコミットする（**公開鍵だけ**コミットする）
- パスフレーズ無しの鍵を作る
- 同じ鍵を他用途（SSH・コード署名など）と兼用する

### 10-5. GRAPHY-Next の「公式鍵」は第三者には配られない

`trusted-keys`（①）に載っているのは **Visionary Imaging Services が自社の公式プラグインを配るための鍵**で、
第三者の作者に渡されることはありません（渡した相手は何でも「公式」として確認画面なしで配れてしまうため）。

第三者の作者は **自分の鍵**を使います。利用者から見た違いは
「初回だけ確認画面が出て、2 回目以降は押すだけになる」ことです。

### 10-6. 手元で検証する

```bash
minisign -V -p minisign.pub -m mean-filter-0.1.0.zip -x mean-filter-0.1.0.zip.minisig
```

> **補足（実装者向け）**: 実物の minisign 0.12 は `-H` を付けなくても
> prehashed（algo `ED`・BLAKE2b-512）で署名します。GRAPHY-Next 側は両形式に対応しています。
> また minisign CLI は鍵 ID を**バイト逆順・大文字 hex** で表示します。

---

## 11. うまくいかないとき

| 症状 | 見るところ |
|---|---|
| メニューに出ない | `plugin.json` が妥当な JSON か / `contributes` に `viewer2d.menu` があるか / アプリを再起動したか |
| メニューには出るがクリックで無反応 | `ui.js` が `activate` を **export** しているか / DevTools のコンソールに import エラーが出ていないか |
| 「シリーズが開かれていません」 | 先にデータベース画面からシリーズを 2D ビューアに表示する |
| 「画像がまだ描画されていないようです」 | ビューアをクリック / スクロールして再描画してから、もう一度実行する |
| シリーズ名が UID のまま | `/api/studies/…/series` が `403` 等。デモとしては続行するので無視して問題ない |
| 大きい画像で固まる | 分離可能フィルタなのでカーネルサイズには依存しませんが、巨大なキャンバスでは時間がかかります |
| 導入ボタンが押せない / `403` | 環境設定 ＞ プラグイン のトグルが OFF、または Web 版 |
| 導入が `422` で拒否される | `engines.os` / `engines.graphy` が非対応、または zip 構造が不正 |
| 「完全性を検証できません」 | Release に `<zip>.sha256` が無い。CI が付けているか確認 |
| CI が「version != tag」で落ちる | `plugin.json` の `version` とタグ `v<version>` を一致させる |
| 確認画面が毎回出る | 未署名。§10-3 で署名すると 2 回目以降は出なくなる |
| `signature check failed: … does not match` | 配布物が署名後に差し替わった、または別の鍵で署名した。**心当たりが無ければ乗っ取りを疑う** |
| `signature check failed: … different key` | 前回と違う鍵で署名した（TOFU）。回避はアンインストール→再導入 |
| 外部 API へ `fetch` すると失敗する | レンダラの CSP。**バックエンド面（JAR）から呼ぶ**（デモ 3 参照） |

---

## 12. できないこと（正直に）

- **このデモが扱うのは表示中の 1 スライスだけです。** API は `sliceIndex` 指定で他スライスも
  読めますが（1 回 1 スライス）、シリーズ全体を回す実装はしていません。
- **保存した派生シリーズは診断用に検証されたものではありません。** 保存物には
  `SeriesDescription` の `[Plugin] ` 接頭辞とプラグイン id・版が必ず残ります（消せません）。
- **カラー画像は輝度に落ちます**（`unit === "raw"`）。
- **v0.1.8 以前の本体には導入できません**（`engines.graphy` が `">=0.1.9"`）。これは意図した挙動です。
- **未署名プラグインの真正性は保証できません。** 同意画面は判断材料を出すだけです。
- **宣言 `permissions` は強制されません。**
- **実行時の隔離がありません。** プラグインはアプリと同じ権限で動きます。
- **Web 版でのユーザー導入は実現していません。**

---

## 参考

- デモ集ハブ: <https://github.com/tatsunidas/graphy-next-plugin-demos>
- 本体: <https://github.com/tatsunidas/GRAPHY-Next>
- ユーザーマニュアル: <https://tatsunidas.github.io/GRAPHY-Next/>
- GRAPHY Lab: <https://graphy.vis-ionary.com/lab/>

## ライセンス

MIT。自分のプラグインの出発点として自由にコピーしてください。
