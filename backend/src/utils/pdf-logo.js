let cachedSource;
let cachedLogo;

async function preparePrintLogo(page, source) {
  if (!/^data:image\//i.test(source || "")) return source || "";
  if (source === cachedSource) return cachedLogo;
  const result = await page.evaluate(async (src) => {
    const image = new Image();
    const loaded = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      image.onload = () => { clearTimeout(timer); resolve(true); };
      image.onerror = () => { clearTimeout(timer); resolve(false); };
      image.src = src;
    });
    if (!loaded || !image.naturalWidth) return src;
    // About 320 dpi at the largest (54 mm) printed logo size.
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(680, image.naturalWidth);
    canvas.height = Math.max(1, Math.round(image.naturalHeight * canvas.width / image.naturalWidth));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  }, source);
  // A single cached logo bounds memory even if the source changes.
  cachedSource = source;
  cachedLogo = result;
  return result;
}

module.exports = { preparePrintLogo };
