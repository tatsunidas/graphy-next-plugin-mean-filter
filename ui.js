/// <reference path="./graphy-plugin.d.ts" />
// @ts-check
/*
 * GRAPHY-Next プラグイン「Mean Filter」のフロント面。
 *
 * 2D ビューアで開いているシリーズの表示画像に k×k の平均化（ボックス）フィルタをかけ、
 * before / after を並べて表示する。
 *
 * ── このデモで見せたいこと ────────────────────────────────────
 *  1. ui.js はレンダラのフルコンテキストで動く（document も fetch も使える）
 *  2. 開いているシリーズを DOM から見つける（data-tile-id 属性）
 *  3. backend の REST API を叩く（import.meta.url から API のオリジンを得る）
 *  4. 自前のダイアログを DOM で組み立てる
 *  5. 画素処理そのものは素の JS（分離可能ボックスフィルタ）
 *
 * ── 注意（README §11 にも書いてあります）─────────────────────
 *  現状の host API には「シリーズの生ピクセル（HU 等）を取る公式の手段」がありません。
 *  そのためこのデモは **表示中のキャンバス**（W/L 適用後の 8bit RGBA）を読みます。
 *  つまり結果は「見た目の平滑化」であって、HU 値に対する定量的なフィルタではありません。
 */

/** backend のオリジン。ui.js は /api/plugins/<id>/ui.js として backend から配信されるので、
 *  自分自身の URL から確実に求められる（apiBase を推測しなくてよい）。 */
const API_ORIGIN = new URL(import.meta.url).origin;

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

  const tiles = findOpenTiles();
  if (tiles.length === 0) {
    host.notify("2D ビューアにシリーズが開かれていません。先にシリーズを表示してください。");
    return;
  }

  // シリーズ名は backend の REST API から取る（取れなくても続行する）。
  await Promise.all(tiles.map((t) => decorateWithSeriesInfo(t)));

  openDialog(host, tiles);
}

// ── 1. 開いているシリーズを見つける ──────────────────────────────

/**
 * 2D ビューアのタイルを列挙する。
 *
 * GRAPHY-Next は各タイルの外枠 <div> に data-tile-id="<studyUid>|<seriesUid>" を持たせている。
 * これは公式の host API ではなく DOM 依存なので、本体の版が上がると変わりうる点に注意
 * （現状これが「開いているシリーズ」を知る唯一の手段）。
 *
 * @returns {{tileId: string, studyUid: string, seriesUid: string, canvas: HTMLCanvasElement, label: string}[]}
 */
function findOpenTiles() {
  const out = [];
  for (const el of document.querySelectorAll("[data-tile-id]")) {
    const tileId = el.getAttribute("data-tile-id") || "";
    const canvas = el.querySelector("canvas");
    if (!tileId || !(canvas instanceof HTMLCanvasElement)) continue;
    if (canvas.width === 0 || canvas.height === 0) continue;
    const [studyUid, seriesUid] = tileId.split("|");
    out.push({ tileId, studyUid, seriesUid, canvas, label: shortUid(seriesUid) });
  }
  return out;
}

/** UID は長いので末尾だけ見せる。 */
function shortUid(uid) {
  if (!uid) return "(unknown)";
  return uid.length <= 18 ? uid : "…" + uid.slice(-16);
}

/**
 * backend からシリーズ情報を取ってラベルを分かりやすくする（失敗しても無視）。
 *
 * GET /api/studies/{studyUid}/series → [{ seriesInstanceUid, seriesDescription, modality, ... }]
 * ui.js からは同一オリジンの backend を素直に fetch できる（CSP の connect-src に含まれる）。
 */
async function decorateWithSeriesInfo(tile) {
  try {
    const url = `${API_ORIGIN}/api/studies/${encodeURIComponent(tile.studyUid)}/series`;
    const res = await fetch(url);
    if (!res.ok) return;
    const list = await res.json();
    const hit = Array.isArray(list)
      ? list.find((s) => s.seriesInstanceUid === tile.seriesUid)
      : null;
    if (!hit) return;
    const parts = [hit.modality, hit.seriesDescription].filter(Boolean);
    if (parts.length > 0) tile.label = parts.join(" / ") + "  " + tile.label;
  } catch {
    /* オフラインでも、権限が無くても、デモとしては続行してよい */
  }
}

// ── 2. 画素を取り出す ────────────────────────────────────────

/**
 * タイルのキャンバスを ImageData として複製する。
 *
 * Cornerstone3D のビューポート キャンバスは 2D の場合も WebGL の場合もあるため、
 * いったんオフスクリーンの 2D キャンバスへ drawImage してから getImageData する
 * （この経路なら両方に対応できる）。
 *
 * @param {HTMLCanvasElement} src
 * @returns {ImageData | null}
 */
function snapshot(src) {
  const off = document.createElement("canvas");
  off.width = src.width;
  off.height = src.height;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0);
  return ctx.getImageData(0, 0, off.width, off.height);
}

/** ほぼ真っ黒なら「描画されていない」可能性が高い。ユーザーに伝えるための判定。 */
function looksBlank(img) {
  const d = img.data;
  let nonBlack = 0;
  // 全画素は見ずに間引く（十分な精度で速い）。
  for (let i = 0; i < d.length; i += 4 * 37) {
    if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 2) nonBlack++;
  }
  return nonBlack === 0;
}

// ── 3. 平均化フィルタ ────────────────────────────────────────

/**
 * k×k の平均化（ボックス）フィルタ。
 *
 * 2 次元のボックスフィルタは「横方向の移動平均 → 縦方向の移動平均」に分解できる（分離可能）。
 * 素朴な二重ループは O(w·h·k²) だが、こうすると O(w·h) で済む。
 * 端は最外画素を繰り返す（clamp）扱いにしている。
 *
 * アルファは触らない（DICOM 画像は不透明）。R/G/B を個別に処理するので、
 * グレースケール（R=G=B）でもカラーでも同じコードで動く。
 *
 * @param {ImageData} img
 * @param {number} k 奇数のカーネルサイズ（3, 5, 7 …）
 * @returns {ImageData}
 */
function meanFilter(img, k) {
  const { width: w, height: h } = img;
  const r = (k - 1) / 2;
  const src = img.data;
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);

  // 横方向の移動平均。
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      // 先頭画素のウィンドウを作る（左側は最左画素で埋める）。
      for (let d = -r; d <= r; d++) sum += src[(y * w + clamp(d, 0, w - 1)) * 4 + c];
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 4 + c] = sum / k;
        // ウィンドウを 1 画素ぶんずらす（出ていく画素を引き、入ってくる画素を足す）。
        const outX = clamp(x - r, 0, w - 1);
        const inX = clamp(x + r + 1, 0, w - 1);
        sum += src[(y * w + inX) * 4 + c] - src[(y * w + outX) * 4 + c];
      }
    }
  }

  // 縦方向の移動平均。
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let d = -r; d <= r; d++) sum += tmp[(clamp(d, 0, h - 1) * w + x) * 4 + c];
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = sum / k;
        const outY = clamp(y - r, 0, h - 1);
        const inY = clamp(y + r + 1, 0, h - 1);
        sum += tmp[(inY * w + x) * 4 + c] - tmp[(outY * w + x) * 4 + c];
      }
    }
  }

  // アルファはそのまま複製。
  for (let i = 3; i < src.length; i += 4) out[i] = src[i];

  return new ImageData(out, w, h);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── 4. 自前のダイアログ ─────────────────────────────────────

/**
 * before / after を並べるモーダルを組み立てる。
 *
 * ui.js はレンダラのフルコンテキストで動くので、こうして DOM を直接組める。
 * 見た目は inline style で付けている（外部 CSS は配信されないため）。
 */
function openDialog(host, tiles) {
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

  // ── 操作行: 対象シリーズ / カーネルサイズ / 実行 / 閉じる
  const bar = el("div", { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px" });
  panel.appendChild(bar);

  bar.appendChild(labelled("対象シリーズ"));
  const seriesSel = document.createElement("select");
  styleInput(seriesSel);
  tiles.forEach((t, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = t.label;
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
  const closeBtn = button("閉じる", "#39415a");
  bar.appendChild(runBtn);
  bar.appendChild(closeBtn);

  const note = el("div", { color: "#93a1b8", fontSize: "12px", marginBottom: "10px", lineHeight: "1.6" });
  note.textContent =
    "表示中のキャンバス（W/L 適用後の 8bit）に対して処理します。HU 値そのものへのフィルタではありません。";
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

  const run = () => {
    const tile = tiles[Number(seriesSel.value)];
    const k = Number(kSel.value);

    const img = snapshot(tile.canvas);
    if (!img) {
      status.textContent = "キャンバスを読み取れませんでした。";
      return;
    }
    if (looksBlank(img)) {
      const msg = "画像がまだ描画されていないようです。ビューアをクリックして再描画してから、もう一度実行してください。";
      status.textContent = msg;
      host.notify(msg);
      return;
    }

    const t0 = performance.now();
    const filtered = meanFilter(img, k);
    const ms = Math.round(performance.now() - t0);

    beforeBox.draw(img);
    afterBox.draw(filtered);
    afterBox.caption.textContent = `平均化後（${k} × ${k}）`;
    status.textContent = `${img.width} × ${img.height} px を ${k}×${k} で平滑化しました（${ms} ms）。`;
  };
  runBtn.onclick = run;

  document.body.appendChild(overlay);
  run(); // 開いた時点で既定のカーネルで 1 回実行しておく
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
