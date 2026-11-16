// ----- Elements -----
const fileInput   = document.getElementById("fileInput");
const canvas      = document.getElementById("canvas");
const ctx         = canvas.getContext("2d", { willReadFrequently: true });
const placeholder = document.getElementById("placeholder");
const brightness  = document.getElementById("brightness");
const contrast    = document.getElementById("contrast");
const brightnessVal = document.getElementById("brightnessVal");
const contrastVal   = document.getElementById("contrastVal");
const filterBtns  = document.querySelectorAll(".filter-btn");
const resetBtn    = document.getElementById("resetBtn");
const downloadBtn = document.getElementById("downloadBtn");
const formatSel   = document.getElementById("format");

// ----- State -----
let originalData = null;      // untouched pixels of the uploaded image
let currentFilter = "none";

// ----- Upload: load the image onto the canvas -----
fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    placeholder.classList.add("hidden");
    canvas.classList.remove("hidden");
    brightness.disabled = false;
    contrast.disabled = false;
    resetControls();
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
});

// ----- Core: re-apply all edits to a fresh copy of the original pixels -----
function applyEdits() {
  if (!originalData) return;

  const out = new ImageData(
    new Uint8ClampedArray(originalData.data),
    originalData.width,
    originalData.height
  );
  const d = out.data;

  const b = Number(brightness.value);                 // -100..100
  const c = Number(contrast.value) * 2.55;            // -255..255
  const factor = (259 * (c + 255)) / (255 * (259 - c));

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], bl = d[i + 2];

    // brightness: add the same amount to every channel
    r += b * 2.55; g += b * 2.55; bl += b * 2.55;

    // contrast: stretch values away from the middle (128)
    r = factor * (r - 128) + 128;
    g = factor * (g - 128) + 128;
    bl = factor * (bl - 128) + 128;

    // filters
    if (currentFilter === "grayscale") {
      const gray = 0.299 * r + 0.587 * g + 0.114 * bl;
      r = g = bl = gray;
    } else if (currentFilter === "sepia") {
      const nr = 0.393 * r + 0.769 * g + 0.189 * bl;
      const ng = 0.349 * r + 0.686 * g + 0.168 * bl;
      const nb = 0.272 * r + 0.534 * g + 0.131 * bl;
      r = nr; g = ng; bl = nb;
    } else if (currentFilter === "invert") {
      r = 255 - r; g = 255 - g; bl = 255 - bl;
    }

    d[i] = r; d[i + 1] = g; d[i + 2] = bl;   // Uint8ClampedArray clamps to 0-255
  }

  ctx.putImageData(out, 0, 0);
}

// ----- Slider events -----
brightness.addEventListener("input", () => {
  brightnessVal.textContent = brightness.value;
  applyEdits();
});
contrast.addEventListener("input", () => {
  contrastVal.textContent = contrast.value;
  applyEdits();
});

// ----- Filter buttons -----
filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentFilter = btn.dataset.filter;
    filterBtns.forEach((b) => {
      const active = b === btn;
      b.classList.toggle("bg-indigo-600", active);
      b.classList.toggle("text-white", active);
    });
    applyEdits();
  });
});

// ----- Reset -----
function resetControls() {
  brightness.value = 0;
  contrast.value = 0;
  brightnessVal.textContent = "0";
  contrastVal.textContent = "0";
  currentFilter = "none";
  filterBtns.forEach((b) => {
    const active = b.dataset.filter === "none";
    b.classList.toggle("bg-indigo-600", active);
    b.classList.toggle("text-white", active);
  });
}
resetBtn.addEventListener("click", () => {
  if (!originalData) return;
  resetControls();
  ctx.putImageData(originalData, 0, 0);
});

// ----- Download -----
downloadBtn.addEventListener("click", () => {
  if (!originalData) return;
  const type = formatSel.value;                       // "png" or "jpeg"
  const link = document.createElement("a");
  link.download = "edited-image." + (type === "jpeg" ? "jpg" : "png");
  link.href = canvas.toDataURL("image/" + type, 0.92);
  link.click();
});
