// ----- Elements -----
const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const filterBtns = document.querySelectorAll(".filter-btn");
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const makeCanvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

// ----- State -----
// `base` holds the committed pixels (after crop / rotate / flip / resize / text).
// `P` holds the live adjustments (brightness, contrast, filter) applied on top of it.
let base = null;          // current committed image (a canvas, never modified in place)
let origin = null;        // the image as first uploaded (for before / after and Reset)
let P = { bright: 0, contrast: 0, filter: "none" };
let history = [], pos = -1;
let crop = null;          // {x, y, w, h} selection in image pixels
let showOriginal = false;
let fileName = "edited-image";
const MAX_SIDE = 2000;    // large photos are scaled down so sliders stay smooth

// ----- Upload -----
$("fileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = makeCanvas(img.naturalWidth * s, img.naturalHeight * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);

    origin = base = c;
    P = { bright: 0, contrast: 0, filter: "none" };
    history = []; pos = -1; crop = null; showOriginal = false;
    $("showOriginal").checked = false;
    fileName = file.name.replace(/\.[^.]+$/, "") || "edited-image";

    $("placeholder").classList.add("hidden");
    canvas.classList.remove("hidden");
    ["brightness", "contrast"].forEach((id) => ($(id).disabled = false));
    document.querySelectorAll("[data-needs-image]").forEach((el) => (el.disabled = false));
    commit("Original");
  };
  img.onerror = () => ($("status").textContent = "Could not read that image.");
  img.src = URL.createObjectURL(file);
});

// ----- Pixel processing: brightness, contrast, filters -----
function boxBlur(s, w, h, R) {            // separable box blur (horizontal then vertical)
  const n = 2 * R + 1, t = Uint8ClampedArray.from(s), o = Uint8ClampedArray.from(s);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let a = 0;
    for (let k = -R; k <= R; k++) a += s[(y * w + clamp(x + k, 0, w - 1)) * 4 + c];
    t[(y * w + x) * 4 + c] = a / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let a = 0;
    for (let k = -R; k <= R; k++) a += t[(clamp(y + k, 0, h - 1) * w + x) * 4 + c];
    o[(y * w + x) * 4 + c] = a / n;
  }
  return o;
}
function sharpen(s, w, h) {               // 3x3 convolution kernel
  const K = [0, -1, 0, -1, 5, -1, 0, -1, 0], o = Uint8ClampedArray.from(s);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let a = 0;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++)
      a += K[(ky + 1) * 3 + kx + 1] * s[(clamp(y + ky, 0, h - 1) * w + clamp(x + kx, 0, w - 1)) * 4 + c];
    o[(y * w + x) * 4 + c] = a;
  }
  return o;
}
function process(img) {
  const d = img.data;
  const b = P.bright * 2.55;
  const c = P.contrast * 2.55;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < d.length; i += 4) {
    let r = factor * (d[i] + b - 128) + 128;
    let g = factor * (d[i + 1] + b - 128) + 128;
    let bl = factor * (d[i + 2] + b - 128) + 128;
    if (P.filter === "grayscale") {
      r = g = bl = 0.299 * r + 0.587 * g + 0.114 * bl;
    } else if (P.filter === "sepia") {
      const nr = 0.393 * r + 0.769 * g + 0.189 * bl;
      const ng = 0.349 * r + 0.686 * g + 0.168 * bl;
      const nb = 0.272 * r + 0.534 * g + 0.131 * bl;
      r = nr; g = ng; bl = nb;
    } else if (P.filter === "invert") {
      r = 255 - r; g = 255 - g; bl = 255 - bl;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = bl;
  }
  if (P.filter === "blur") d.set(boxBlur(d, img.width, img.height, 3));
  if (P.filter === "sharpen") d.set(sharpen(d, img.width, img.height));
}
function edited(src) {                    // copy of `src` with the live adjustments applied
  const c = makeCanvas(src.width, src.height);
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(src, 0, 0);
  if (P.bright || P.contrast || P.filter !== "none") {
    const img = x.getImageData(0, 0, c.width, c.height);
    process(img);
    x.putImageData(img, 0, 0);
  }
  return c;
}

// ----- Drawing to the screen -----
let raf = 0;
const render = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); };
function paint() {
  if (!base) return;
  const c = showOriginal ? origin : edited(base);
  canvas.width = c.width; canvas.height = c.height;
  ctx.drawImage(c, 0, 0);
  if (crop && !showOriginal) {            // dim everything outside the crop box
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(crop.x, crop.y, crop.w, crop.h);
    ctx.fill("evenodd");
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(2, canvas.width / 400);
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
    ctx.restore();
  }
}

// ----- History (undo / redo) -----
function commit(label) {
  history = history.slice(0, pos + 1);    // a new edit discards the redo branch
  history.push({ label, base, P: { ...P } });
  pos = history.length - 1;
  sync(); render();
}
function restore(i) {
  pos = i; base = history[i].base; P = { ...history[i].P }; crop = null;
  sync(); render();
}
function sync() {                         // update controls to match the current state
  $("undoBtn").disabled = pos <= 0;
  $("redoBtn").disabled = pos >= history.length - 1;
  $("brightness").value = P.bright; $("brightnessVal").textContent = P.bright;
  $("contrast").value = P.contrast; $("contrastVal").textContent = P.contrast;
  filterBtns.forEach((b) => {
    const on = b.dataset.filter === P.filter;
    b.classList.toggle("bg-indigo-600", on);
    b.classList.toggle("text-white", on);
  });
  $("resizeW").value = base.width; $("resizeH").value = base.height;
  $("status").textContent = `${fileName} \u00b7 ${base.width}\u00d7${base.height}px`;
  $("historyList").innerHTML = history
    .map((h, i) => `<li class="${i === pos ? "text-indigo-700 font-medium" : ""}">${h.label}</li>`).join("");
}
const undo = () => pos > 0 && restore(pos - 1);
const redo = () => pos < history.length - 1 && restore(pos + 1);
$("undoBtn").addEventListener("click", undo);
$("redoBtn").addEventListener("click", redo);
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (k === "y") { e.preventDefault(); redo(); }
});

// ----- Sliders: preview while dragging, save to history on release -----
[["brightness", "bright", "Brightness"], ["contrast", "contrast", "Contrast"]].forEach(([id, key, label]) => {
  $(id).addEventListener("input", () => {
    P[key] = Number($(id).value);
    $(id + "Val").textContent = $(id).value;
    render();
  });
  $(id).addEventListener("change", () => base && commit(`${label} ${$(id).value}`));
});

// ----- Filter buttons -----
filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!base) return;
    P.filter = btn.dataset.filter;
    commit("Filter: " + P.filter);
  });
});

// ----- Before / after -----
$("showOriginal").addEventListener("change", (e) => { showOriginal = e.target.checked; render(); });

// ----- Rotate and flip: these change the pixels, so they create a new base -----
function bake(label, draw) {
  const c = makeCanvas(base.width, base.height);
  draw(c.getContext("2d"), base);
  base = c;
  commit(label);
}
function rotate(dir) {
  const c = makeCanvas(base.height, base.width);          // width and height swap
  const x = c.getContext("2d");
  x.translate(c.width / 2, c.height / 2);
  x.rotate(dir * Math.PI / 2);
  x.drawImage(base, -base.width / 2, -base.height / 2);
  base = c;
  commit(dir > 0 ? "Rotate right" : "Rotate left");
}
$("rotL").addEventListener("click", () => rotate(-1));
$("rotR").addEventListener("click", () => rotate(1));
$("flipH").addEventListener("click", () => bake("Flip horizontal", (x, b) => { x.translate(b.width, 0); x.scale(-1, 1); x.drawImage(b, 0, 0); }));
$("flipV").addEventListener("click", () => bake("Flip vertical", (x, b) => { x.translate(0, b.height); x.scale(1, -1); x.drawImage(b, 0, 0); }));

// ----- Crop: drag a box on the canvas -----
let dragStart = null;
const point = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
};
canvas.addEventListener("pointerdown", (e) => {
  if (!base || showOriginal) return;
  dragStart = point(e);
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragStart) return;
  const p = point(e);
  const x = clamp(Math.min(p.x, dragStart.x), 0, canvas.width), y = clamp(Math.min(p.y, dragStart.y), 0, canvas.height);
  crop = {
    x, y,
    w: clamp(Math.max(p.x, dragStart.x), 0, canvas.width) - x,
    h: clamp(Math.max(p.y, dragStart.y), 0, canvas.height) - y,
  };
  paint();
});
canvas.addEventListener("pointerup", () => (dragStart = null));
$("cancelCrop").addEventListener("click", () => { crop = null; paint(); });
$("applyCrop").addEventListener("click", () => {
  if (!crop || crop.w < 2 || crop.h < 2) { $("status").textContent = "Drag on the image to select a crop area first."; return; }
  const c = makeCanvas(crop.w, crop.h);
  c.getContext("2d").drawImage(base, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
  base = c; crop = null;
  commit("Crop");
});

// ----- Resize -----
$("resizeW").addEventListener("input", () => {
  if (base && $("resizeLock").checked) $("resizeH").value = Math.round($("resizeW").value * base.height / base.width);
});
$("resizeH").addEventListener("input", () => {
  if (base && $("resizeLock").checked) $("resizeW").value = Math.round($("resizeH").value * base.width / base.height);
});
$("applyResize").addEventListener("click", () => {
  const w = Number($("resizeW").value), h = Number($("resizeH").value);
  if (!(w > 0 && h > 0) || w > 8000 || h > 8000) { $("status").textContent = "Enter a width and height between 1 and 8000."; return; }
  const c = makeCanvas(w, h);
  const x = c.getContext("2d");
  x.imageSmoothingQuality = "high";
  x.drawImage(base, 0, 0, c.width, c.height);
  base = c;
  commit(`Resize ${c.width}\u00d7${c.height}`);
});

// ----- Text overlay -----
$("textSize").addEventListener("input", () => ($("textSizeVal").textContent = $("textSize").value));
$("addText").addEventListener("click", () => {
  const text = $("textInput").value.trim();
  if (!text) { $("status").textContent = "Type some text first."; return; }
  bake("Text: " + text.slice(0, 18), (x, b) => {
    const size = Number($("textSize").value), pos = $("textPos").value;
    x.drawImage(b, 0, 0);
    x.font = `${$("textItalic").checked ? "italic " : ""}${$("textBold").checked ? "bold " : ""}${size}px "${$("textFont").value}"`;
    x.fillStyle = $("textColor").value;
    x.textAlign = "center"; x.textBaseline = "middle";
    x.shadowColor = "rgba(0,0,0,.4)"; x.shadowBlur = size / 8;
    const y = pos === "Top" ? size : pos === "Bottom" ? b.height - size : b.height / 2;
    x.fillText(text, b.width / 2, y, b.width * 0.95);
  });
});

// ----- Reset -----
$("resetBtn").addEventListener("click", () => {
  if (!base) return;
  base = origin; P = { bright: 0, contrast: 0, filter: "none" }; crop = null;
  commit("Reset");
});

// ----- Download -----
$("quality").addEventListener("input", () => ($("qualityVal").textContent = $("quality").value));
$("downloadBtn").addEventListener("click", () => {
  if (!base) return;
  const type = $("format").value;                       // "png" or "jpeg"
  let out = edited(base);
  if (type === "jpeg") {                                // JPG has no transparency: fill white first
    const f = makeCanvas(out.width, out.height), x = f.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, f.width, f.height); x.drawImage(out, 0, 0);
    out = f;
  }
  const link = document.createElement("a");
  link.download = fileName + "." + (type === "jpeg" ? "jpg" : "png");
  link.href = out.toDataURL("image/" + type, Number($("quality").value) / 100);
  link.click();
});
