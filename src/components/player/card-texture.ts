"use client";

/**
 * Turns the player card's own SVG art into canvases for the 3D card, so the
 * 3D object shows exactly the card the app already designs (tiers, foils,
 * photo, numbers) rather than a redrawn copy. An SVG drawn as an image can't
 * see the page's web fonts, so the card's font is embedded into it first.
 *
 * The front is drawn as separate depth layers (marked with data-layer in the
 * SVG): the background, the portrait and the printed information. The 3D card
 * stacks them at slightly different depths, so they shift against each other
 * as it tilts. The printed border is left out: the 3D card has a metal frame.
 */

const CARD_WIDTH = 320;
const CARD_HEIGHT = 472;
const CARD_FONT = "Barlow Condensed";

let fontCss: Promise<string> | null = null;

async function toDataUrl(url: string) {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The page's @font-face rules for the card font, with their files inlined. */
function embeddedFontCss() {
  fontCss ??= (async () => {
    const rules: { rule: CSSFontFaceRule; base: string }[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let cssRules: CSSRuleList;
      try {
        cssRules = sheet.cssRules;
      } catch {
        continue; // A stylesheet from another origin; the card font is self-hosted, so skip it.
      }
      for (const rule of Array.from(cssRules)) {
        if (rule instanceof CSSFontFaceRule && rule.style.getPropertyValue("font-family").includes(CARD_FONT)) {
          // Font URLs are relative to the stylesheet that declares them, not to the page.
          rules.push({ rule, base: sheet.href ?? document.baseURI });
        }
      }
    }
    const blocks = await Promise.all(
      rules.map(async ({ rule, base }) => {
        const src = rule.style.getPropertyValue("src");
        const match = /url\(["']?([^"')]+)["']?\)/.exec(src);
        if (!match) return "";
        const data = await toDataUrl(new URL(match[1], base).href);
        const weight = rule.style.getPropertyValue("font-weight") || "400";
        const style = rule.style.getPropertyValue("font-style") || "normal";
        const range = rule.style.getPropertyValue("unicode-range");
        return `@font-face{font-family:"${CARD_FONT}";src:url(${data}) format("woff2");font-weight:${weight};font-style:${style};${range ? `unicode-range:${range};` : ""}}`;
      }),
    );
    return blocks.join("");
  })();
  return fontCss;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export type CardLayer = "base" | "portrait" | "info";
export type CardFaces = { base: HTMLCanvasElement; portrait: HTMLCanvasElement; info: HTMLCanvasElement; back: HTMLCanvasElement };

async function svgToCanvas(
  svg: SVGSVGElement,
  scale: number,
  sharedDefs: SVGDefsElement | null,
  css: string,
  layer?: CardLayer,
) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // Keep only this layer's art (and anything unmarked, such as defs); always drop the printed border.
  for (const node of Array.from(clone.querySelectorAll("[data-layer]"))) {
    const own = node.getAttribute("data-layer");
    if (own === "frame" || (layer && own !== layer)) node.remove();
  }
  clone.removeAttribute("style");
  clone.removeAttribute("class");
  clone.setAttribute("width", String(CARD_WIDTH * scale));
  clone.setAttribute("height", String(CARD_HEIGHT * scale));
  // The back face borrows the front's gradients and patterns by id; give it its own copy.
  if (sharedDefs && !clone.querySelector("defs")) clone.insertBefore(sharedDefs.cloneNode(true), clone.firstChild);
  const style = document.createElementNS(SVG_NS, "style");
  style.textContent = css;
  clone.insertBefore(style, clone.firstChild);
  const markup = new XMLSerializer()
    .serializeToString(clone)
    // Single quotes: these land inside double-quoted attributes.
    .replaceAll("var(--font-barlow-condensed)", `'${CARD_FONT}'`);

  const image = new Image();
  image.decoding = "async";
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH * scale;
  canvas.height = CARD_HEIGHT * scale;
  const context = canvas.getContext("2d")!;
  if (layer === "info") {
    // Printed type casts a faint shadow onto the layers beneath it.
    context.shadowColor = "rgb(0 0 0 / 55%)";
    context.shadowBlur = 5 * scale;
    context.shadowOffsetY = 1.5 * scale;
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** The card under `root` (front layers and back), rendered at `scale` times its 320 × 472 design. */
export async function rasterizeCard(root: HTMLElement, scale: number): Promise<CardFaces> {
  const front = root.querySelector<SVGSVGElement>('svg[data-card-face="front"]');
  const back = root.querySelector<SVGSVGElement>('svg[data-card-face="back"]');
  if (!front || !back) throw new Error("Card art not found");
  await document.fonts.ready;
  const css = await embeddedFontCss();
  const defs = front.querySelector("defs");
  const [base, portrait, info, backCanvas] = await Promise.all([
    svgToCanvas(front, scale, null, css, "base"),
    svgToCanvas(front, scale, null, css, "portrait"),
    svgToCanvas(front, scale, null, css, "info"),
    svgToCanvas(back, scale, defs, css),
  ]);
  return { base, portrait, info, back: backCanvas };
}
