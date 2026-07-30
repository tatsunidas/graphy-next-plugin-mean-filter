/// <reference path="./graphy-plugin.d.ts" />
// @ts-check
/*
 * GRAPHY-Next プラグイン「Mean Filter」のフロント面。
 *
 * 2D ビューアで開いているシリーズの**生の画素（CT なら HU）**に k×k の平均化（ボックス）
 * フィルタをかけ、before / after を並べて表示する。結果はビューアへ重ねたり、
 * 派生シリーズとして保存したりできる。
 *
 * ── このデモで見せたいこと ────────────────────────────────────
 *  1. ui.js はレンダラのフルコンテキストで動く（document も fetch も使える）
 *  2. 開いているシリーズは **host.getTargets()** で分かる（DOM を覗かない）
 *  3. 画素は **host.getPixelData()** で取れる（W/L 適用前の定量値）
 *  4. 結果は **host.showOverlay()** で重ねられ、**host.saveDerivedSeries()** で残せる
 *  5. 自前のダイアログを DOM で組み立てる
 *  6. 画素処理そのものは素の JS（分離可能ボックスフィルタ）
 *
 * ── 必要な本体の版 ───────────────────────────────────────────
 *  getTargets / getPixelData / showOverlay / saveDerivedSeries は **GRAPHY-Next 0.1.9 以降**。
 *  plugin.json の engines.graphy を ">=0.1.9" にしてあるので、古い本体には導入されない。
 */

/** 既定のカーネルサイズ（奇数）。 */
const DEFAULT_K = 3;

/**
 * プラグインの入口。2D ビューアの Plug-ins メニューから呼ばれる。
 *
 * @param {import('./graphy-plugin').PluginHost} host
 */
export async function activate(host) {
  if (host.surface === "mainscreen.menu") {
    host.notify("このプラグインは 2D ビューアの Plug-ins メニューから実行してください。");
    return;
  }

  // 開いているシリーズは公式 API で分かる（以前は DOM の data-tile-id を見ていた）。
  const targets = host.getTargets();
  if (targets.length === 0) {
    host.notify("2D ビューアにシリーズが開かれていません。先にシリーズを表示してください。");
    return;
  }

  openDialog(host, targets);
}

// ── 1. 平均化フィルタ ────────────────────────────────────────

/**
 * k×k の平均化（ボックス）フィルタ。**単チャンネルの実数**（HU 等）に対して動く。
 *
 * 2 次元のボックスフィルタは「横方向の移動平均 → 縦方向の移動平均」に分解できる（分離可能）。
 * 素朴な二重ループは O(w·h·k²) だが、こうすると O(w·h) で済む。
 * 端は最外画素を繰り返す（clamp）扱いにしている。
 *
 * @param {Float32Array} src
 * @param {number} w
 * @param {number} h
 * @param {number} k 奇数のカーネルサイズ（3, 5, 7 …）
 * @returns {Float32Array}
 */
function meanFilter(src, w, h, k) {
  const r = (k - 1) / 2;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);

  // 横方向の移動平均。
  for (let y = 0; y < h; y++) {
    let sum = 0;
    // 先頭画素のウィンドウを作る（左側は最左画素で埋める）。
    for (let d = -r; d <= r; d++) sum += src[y * w + clamp(d, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / k;
      // ウィンドウを 1 画素ぶんずらす（出ていく画素を引き、入ってくる画素を足す）。
      sum += src[y * w + clamp(x + r + 1, 0, w - 1)] - src[y * w + clamp(x - r, 0, w - 1)];
    }
  }

  // 縦方向の移動平均。
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let d = -r; d <= r; d++) sum += tmp[clamp(d, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / k;
      sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }

  return out;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── 2. 表示用のレンダリング ──────────────────────────────────
//
// 画素は定量値（HU）なので、見せるときは自分で W/L を掛けて 8bit にする。
// ビューアと同じ見え方にしたいので、W/L は host.getViewState() から借りる。

/**
 * 実数マップを W/L で 8bit グレースケールへ焼き、ImageData にする。
 *
 * @param {Float32Array} values
 * @param {number} w
 * @param {number} h
 * @param {{center: number, width: number}} win
 */
function toImageData(values, w, h, win) {
  const img = new ImageData(w, h);
  const lower = win.center - win.width / 2;
  const scale = win.width > 0 ? 255 / win.width : 0;
  for (let i = 0; i < values.length; i++) {
    let g = Math.round((values[i] - lower) * scale);
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    const o = i * 4;
    img.data[o] = g;
    img.data[o + 1] = g;
    img.data[o + 2] = g;
    img.data[o + 3] = 255;
  }
  return img;
}

/** min / max / mean（NaN は無視）。before / after の違いを数字でも見せる。 */
function stats(values) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n++;
  }
  return n === 0 ? null : { min, max, mean: sum / n };
}

// ── 3. 自前のダイアログ ─────────────────────────────────────

/**
 * before / after を並べるモーダルを組み立てる。
 *
 * ui.js はレンダラのフルコンテキストで動くので、こうして DOM を直接組める。
 * 見た目は inline style で付けている（外部 CSS は配信されないため）。
 *
 * @param {import('./graphy-plugin').Viewer2DPluginHost} host
 * @param {import('./graphy-plugin').ViewerTarget[]} targets
 */
function openDialog(host, targets) {
  const overlay = el("div", {
    position: "fixed",
    inset: "0",
    zIndex: "99999",
    background: "rgba(0,0,0,0.65)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "13px system-ui, sans-serif",
    color: "#e8ecf5",
  });

  const panel = el("div", {
    background: "#161d2e",
    border: "1px solid #2a3550",
    borderRadius: "10px",
    padding: "16px 18px",
    maxWidth: "min(1100px, 94vw)",
    maxHeight: "92vh",
    overflow: "auto",
    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
  });
  overlay.appendChild(panel);

  const title = el("div", { fontSize: "15px", fontWeight: "700", marginBottom: "10px" });
  title.textContent = "Mean Filter — 平均化フィルタ";
  panel.appendChild(title);

  // ── 操作行: 対象シリーズ / カーネルサイズ / 実行 / 重ねる / 保存 / 閉じる
  const bar = el("div", { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px" });
  panel.appendChild(bar);

  bar.appendChild(labelled("対象シリーズ"));
  const seriesSel = document.createElement("select");
  styleInput(seriesSel);
  targets.forEach((t, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    // シリーズ名・モダリティ・スライス位置は getTargets() が教えてくれる（REST を叩く必要が無い）。
    o.textContent = `${t.seriesLabel} [${t.modality}] ${t.sliceIndex + 1}/${t.sliceCount}`;
    seriesSel.appendChild(o);
  });
  bar.appendChild(seriesSel);

  bar.appendChild(labelled("カーネル"));
  const kSel = document.createElement("select");
  styleInput(kSel);
  for (const k of [3, 5, 7, 9, 15]) {
    const o = document.createElement("option");
    o.value = String(k);
    o.textContent = `${k} × ${k}`;
    if (k === DEFAULT_K) o.selected = true;
    kSel.appendChild(o);
  }
  bar.appendChild(kSel);

  const runBtn = button("実行", "#0b5cad");
  const overlayBtn = button("ビューアに重ねる", "#2b6a4b");
  const saveBtn = button("シリーズとして保存", "#6a4b2b");
  const closeBtn = button("閉じる", "#39415a");
  bar.appendChild(runBtn);
  bar.appendChild(overlayBtn);
  bar.appendChild(saveBtn);
  bar.appendChild(closeBtn);

  const note = el("div", { color: "#93a1b8", fontSize: "12px", marginBottom: "10px", lineHeight: "1.6" });
  note.textContent =
    "生の画素（CT なら HU）に対して処理します。下のプレビューは、ビューアと同じ W/L で焼いた見た目です。";
  panel.appendChild(note);

  // ── 画像の並び
  const grid = el("div", { display: "flex", gap: "14px", flexWrap: "wrap", alignItems: "flex-start" });
  panel.appendChild(grid);
  const beforeBox = imageBox("元画像");
  const afterBox = imageBox("平均化後");
  grid.appendChild(beforeBox.wrap);
  grid.appendChild(afterBox.wrap);

  const status = el("div", { marginTop: "10px", color: "#93a1b8", fontSize: "12px", minHeight: "1.4em" });
  panel.appendChild(status);

  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  closeBtn.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  document.addEventListener("keydown", onKey);

  /** 直近の結果（「重ねる」「保存」で使う）。 */
  let last = null;

  const run = async () => {
    // ⚠ 対象は毎回読み直す。ダイアログを開いている間にユーザーがスライスを送るので、
    //    activate 時の値を使い回すと「古いスライスに対する結果」を出してしまう。
    const current = host.getTargets();
    const target = current[Number(seriesSel.value)] ?? current[0];
    if (!target) {
      status.textContent = "対象のシリーズが見つかりません（ビューアを開き直してください）。";
      return;
    }
    const k = Number(kSel.value);

    const px = await host.getPixelData(target.tileId);
    if (!px) {
      status.textContent = "画素を取得できませんでした。";
      return;
    }

    const t0 = performance.now();
    const filtered = meanFilter(px.data, px.cols, px.rows, k);
    const ms = Math.round(performance.now() - t0);

    // プレビューはビューアと同じ W/L で焼く（取れなければ値域から作る）。
    const view = host.getViewState(target.tileId);
    const before = stats(px.data);
    const win = view
      ? { center: view.windowCenter, width: view.windowWidth }
      : before
        ? { center: (before.min + before.max) / 2, width: before.max - before.min }
        : { center: 0, width: 1 };

    beforeBox.draw(toImageData(px.data, px.cols, px.rows, win));
    afterBox.draw(toImageData(filtered, px.cols, px.rows, win));
    afterBox.caption.textContent = `平均化後（${k} × ${k}）`;

    const after = stats(filtered);
    status.textContent =
      `${px.cols} × ${px.rows} px を ${k}×${k} で平滑化しました（${ms} ms）。` +
      (before && after
        ? ` 元: min ${before.min.toFixed(0)} / max ${before.max.toFixed(0)} / mean ${before.mean.toFixed(1)} ${px.unit}` +
          ` → 後: min ${after.min.toFixed(0)} / max ${after.max.toFixed(0)} / mean ${after.mean.toFixed(1)} ${px.unit}`
        : "");

    last = { target, px, filtered, k, win };
  };
  runBtn.onclick = () => {
    void run();
  };

  // 結果をビューアへ重ねる（値を渡すだけ。色付けは本体がする）。
  overlayBtn.onclick = () => {
    if (!last) {
      status.textContent = "先に「実行」を押してください。";
      return;
    }
    const ok = host.showOverlay(last.target.tileId, {
      data: last.filtered,
      rows: last.px.rows,
      cols: last.px.cols,
      window: last.win,
      opacity: 1,
    });
    status.textContent = ok
      ? "ビューアに重ねました（スライスを送ると隠れます。もう一度押すと更新されます）。"
      : "重ねられませんでした（表示中のスライスが変わった可能性があります）。";
  };

  // 結果を派生シリーズとして保存する（本体が確認ダイアログを出す）。
  saveBtn.onclick = async () => {
    if (!last) {
      status.textContent = "先に「実行」を押してください。";
      return;
    }
    const res = await host.saveDerivedSeries(last.target.tileId, {
      seriesDescription: `Mean ${last.k}x${last.k}`,
      derivationDescription: `Mean filter ${last.k}x${last.k} (separable box)`,
      frames: [{ sliceIndex: last.px.sliceIndex, data: last.filtered }],
      rows: last.px.rows,
      cols: last.px.cols,
      unit: last.px.unit,
    });
    status.textContent = res.ok
      ? `保存しました（${res.instanceCount} 枚）。データベース画面のシリーズ一覧に出ます。`
      : res.cancelled
        ? "保存はキャンセルされました。"
        : `保存に失敗しました: ${res.error ?? "unknown"}`;
  };

  document.body.appendChild(overlay);
  void run(); // 開いた時点で既定のカーネルで 1 回実行しておく
}

// ── DOM ヘルパ ─────────────────────────────────────────────

function el(tag, style) {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  return e;
}

function labelled(text) {
  const s = el("span", { color: "#93a1b8" });
  s.textContent = text;
  return s;
}

function styleInput(e) {
  Object.assign(e.style, {
    background: "#0f1626",
    color: "#e8ecf5",
    border: "1px solid #2a3550",
    borderRadius: "6px",
    padding: "4px 8px",
    font: "inherit",
    maxWidth: "320px",
  });
}

function button(text, bg) {
  const b = document.createElement("button");
  b.textContent = text;
  Object.assign(b.style, {
    background: bg,
    color: "#fff",
    border: "0",
    borderRadius: "6px",
    padding: "6px 14px",
    cursor: "pointer",
    font: "inherit",
    fontWeight: "600",
  });
  return b;
}

/** キャプション付きのキャンバス枠。 */
function imageBox(captionText) {
  const wrap = el("div", { display: "flex", flexDirection: "column", gap: "6px" });
  const caption = el("div", { color: "#93a1b8", fontSize: "12px" });
  caption.textContent = captionText;
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, {
    border: "1px solid #2a3550",
    borderRadius: "6px",
    background: "#000",
    maxWidth: "min(480px, 44vw)",
    height: "auto",
  });
  wrap.appendChild(caption);
  wrap.appendChild(canvas);
  return {
    wrap,
    caption,
    draw(img) {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.putImageData(img, 0, 0);
    },
  };
}
