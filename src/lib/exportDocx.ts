// Word export: walks the rendered HTML (same pipeline as PDF) and builds a .docx.
// Formulas become PNG images rendered with MathJax; attachments are embedded as PNG.
// Loaded on demand (docx + MathJax are big).
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
  type ParagraphChild,
} from "docx";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { api } from "./api";
import { FONT_PT, MARGINS, PAPERS, bodyHtml, type ExportDoc, type ExportOptions } from "./exporter";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const mathDoc = mathjax.document("", {
  InputJax: new TeX({ packages: AllPackages }),
  OutputJax: new SVG({ fontCache: "none" }),
});

interface Img {
  data: Uint8Array;
  width: number;
  height: number;
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const SCALE = 3; // pixel density of rasterized formulas/images

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error("image"));
    img.src = url;
  });
}

async function toPng(img: HTMLImageElement, w: number, h: number, scale: number): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b!), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Formula → PNG sized for a `fontPx` text size. */
async function mathPng(tex: string, display: boolean, fontPx: number): Promise<Img | null> {
  try {
    const node = mathDoc.convert(tex, { display });
    let svg = adaptor.innerHTML(node);
    const ex = fontPx * 0.45;
    const size = (attr: string) => Number(/([\d.]+)ex/.exec(new RegExp(`${attr}="([^"]+)"`).exec(svg)?.[1] ?? "")?.[1] ?? 1) * ex;
    const width = size("width");
    const height = size("height");
    svg = svg.replace(/^<svg /, `<svg xmlns="http://www.w3.org/2000/svg" `).replace(/currentColor/g, "#000");
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const img = await loadImage(url);
      return { data: await toPng(img, width, height, SCALE), width, height };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

async function attachmentPng(name: string, cssWidth: number | null, maxWidth: number): Promise<Img | null> {
  try {
    const bytes = await api.readAttachment(name);
    const ext = name.split(".").pop()?.toLowerCase();
    const type = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    try {
      const img = await loadImage(url);
      let width = cssWidth ?? img.naturalWidth;
      width = Math.min(width, maxWidth);
      const height = (width * img.naturalHeight) / Math.max(1, img.naturalWidth);
      return { data: await toPng(img, width, height, Math.max(1, Math.min(2, img.naturalWidth / width || 1))), width, height };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

const texOf = (el: Element) => el.querySelector("annotation")?.textContent ?? "";

interface Style {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
}

export async function toDocx(doc: ExportDoc, o: ExportOptions): Promise<Uint8Array> {
  const fontPt = FONT_PT[o.font];
  const fontPx = (fontPt * 96) / 72;
  const [pw, ph] = PAPERS[o.paper];
  const contentPx = ((o.landscape ? ph : pw) - 2 * MARGINS[o.margins]) * 96;

  const root = document.createElement("div");
  root.innerHTML = await bodyHtml(doc);

  // Rasterize formulas and images first (async), then walk synchronously.
  const images = new Map<Element, Img | null>();
  const jobs: Promise<void>[] = [];
  root.querySelectorAll(".latex-block, .latex-inline").forEach((el) => {
    const display = el.classList.contains("latex-block");
    jobs.push(mathPng(texOf(el), display, display ? fontPx * 1.1 : fontPx).then((r) => void images.set(el, r)));
  });
  root.querySelectorAll("img.embed").forEach((el) => {
    const w = /width:\s*(\d+)px/.exec(el.getAttribute("style") ?? "")?.[1];
    jobs.push(attachmentPng(el.getAttribute("alt") ?? "", w ? Number(w) : null, contentPx).then((r) => void images.set(el, r)));
  });
  await Promise.all(jobs);

  let listInstance = 0;
  const codeShade = o.saveInk ? undefined : { type: ShadingType.CLEAR, color: "auto", fill: "F3F3F3" };

  const image = (img: Img) => new ImageRun({ type: "png", data: img.data, transformation: { width: img.width, height: img.height } });

  function inlines(node: Node, s: Style = {}): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const text = (n.textContent ?? "").replace(/\n/g, " ");
        if (text) {
          out.push(
            new TextRun({
              text, bold: s.bold, italics: s.italics, strike: s.strike,
              font: s.code ? "Consolas" : undefined, shading: s.code ? codeShade : undefined,
            }),
          );
        }
        return;
      }
      if (!(n instanceof HTMLElement)) return;
      const tag = n.tagName;
      if (n.classList.contains("latex-inline")) {
        const img = images.get(n);
        out.push(img ? image(img) : new TextRun({ text: `$${texOf(n)}$`, font: "Consolas" }));
      } else if (tag === "IMG") {
        const img = images.get(n);
        out.push(img ? image(img) : new TextRun({ text: `[${n.getAttribute("alt") ?? ""}]`, italics: true }));
      } else if (tag === "BR") {
        out.push(new TextRun({ text: "", break: 1 }));
      } else if (tag === "INPUT") {
        out.push(new TextRun({ text: n.hasAttribute("checked") ? "☑ " : "☐ " }));
      } else if (tag === "A" && n.getAttribute("href")) {
        out.push(
          new ExternalHyperlink({
            link: n.getAttribute("href")!,
            children: [new TextRun({ text: n.textContent ?? "", style: "Hyperlink", bold: s.bold, italics: s.italics })],
          }),
        );
      } else if (tag === "UL" || tag === "OL") {
        // nested lists are handled by the list walker
      } else {
        out.push(
          ...inlines(n, {
            bold: s.bold || tag === "STRONG" || tag === "B",
            italics: s.italics || tag === "EM" || tag === "I",
            strike: s.strike || tag === "DEL" || tag === "S",
            code: s.code || tag === "CODE",
          }),
        );
      }
    });
    return out;
  }

  type Block = Paragraph | Table;
  const quoteOpts = (q: number) =>
    q ? { indent: { left: convertInchesToTwip(0.3 * q) }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: "999999", space: 8 } } } : {};

  function list(el: Element, level: number, q: number, out: Block[]) {
    const ordered = el.tagName === "OL";
    const instance = ++listInstance;
    for (const li of el.children) {
      if (li.tagName !== "LI") continue;
      // A loose list wraps item text in <p>: flatten it.
      const holder = document.createElement("span");
      li.childNodes.forEach((c) => {
        if (c instanceof HTMLElement && (c.tagName === "UL" || c.tagName === "OL")) return;
        holder.append(c.cloneNode(true));
      });
      holder.querySelectorAll("p").forEach((p) => p.replaceWith(...p.childNodes));
      // Task items show their checkbox instead of a bullet.
      const task = !!holder.querySelector(":scope > input");
      out.push(
        new Paragraph({
          children: inlines(holder),
          ...(task
            ? { indent: { left: convertInchesToTwip(0.35 * (level + 1)) } }
            : ordered
              ? { numbering: { reference: "ol", level, instance } }
              : { bullet: { level } }),
          ...quoteOpts(q),
        }),
      );
      for (const c of li.children) if (c.tagName === "UL" || c.tagName === "OL") list(c, Math.min(level + 1, 4), q, out);
    }
  }

  function blocks(el: Element, out: Block[], q = 0) {
    for (const n of el.children) {
      const tag = n.tagName;
      if (/^H[1-6]$/.test(tag)) {
        out.push(new Paragraph({ heading: HEADINGS[Number(tag[1]) - 1], children: inlines(n), keepNext: true }));
      } else if (tag === "P") {
        const italics = n.classList.contains("x-video");
        out.push(new Paragraph({ children: inlines(n, { italics }), spacing: { after: 120 }, ...quoteOpts(q) }));
      } else if (tag === "UL" || tag === "OL") {
        list(n, 0, q, out);
      } else if (tag === "BLOCKQUOTE") {
        blocks(n, out, q + 1);
      } else if (tag === "PRE") {
        const code = (n.querySelector("code")?.textContent ?? n.textContent ?? "").replace(/\n$/, "");
        for (const line of code.split("\n")) {
          out.push(
            new Paragraph({
              children: [new TextRun({ text: line || " ", font: "Consolas", size: Math.round(fontPt * 1.7) })],
              shading: codeShade,
              spacing: { after: 0, line: 260 },
              ...quoteOpts(q),
            }),
          );
        }
        out.push(new Paragraph({ children: [] }));
      } else if (n.classList.contains("latex-block")) {
        const img = images.get(n);
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [img ? image(img) : new TextRun({ text: texOf(n), font: "Consolas" })],
            spacing: { before: 80, after: 120 },
          }),
        );
      } else if (tag === "TABLE") {
        const rows = [...n.querySelectorAll("tr")].map(
          (tr) =>
            new TableRow({
              tableHeader: tr.parentElement?.tagName === "THEAD",
              children: [...tr.children].map(
                (cell) =>
                  new TableCell({
                    children: [new Paragraph({ children: inlines(cell, { bold: cell.tagName === "TH" }) })],
                    shading: cell.tagName === "TH" && !o.saveInk ? { type: ShadingType.CLEAR, color: "auto", fill: "EDEDED" } : undefined,
                  }),
              ),
            }),
        );
        if (rows.length) out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }), new Paragraph({ children: [] }));
      } else if (tag === "HR") {
        out.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } } }));
      } else if (tag === "IMG" || tag === "VIDEO" || tag === "SPAN") {
        out.push(new Paragraph({ children: inlines({ childNodes: [n] } as unknown as Node), ...quoteOpts(q) }));
      } else {
        blocks(n, out, q);
      }
    }
  }

  const children: Block[] = [];
  blocks(root, children);

  const [w, h] = PAPERS[o.paper];
  const margin = convertInchesToTwip(MARGINS[o.margins]);
  const document_ = new Document({
    creator: "Kaizen Study",
    title: doc.title,
    styles: { default: { document: { run: { font: "Calibri", size: Math.round(fontPt * 2) } } } },
    numbering: {
      config: [
        {
          reference: "ol",
          levels: [0, 1, 2, 3, 4].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.35 * (level + 1)), hanging: convertInchesToTwip(0.25) } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertInchesToTwip(w),
              height: convertInchesToTwip(h),
              orientation: o.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: { top: margin, bottom: margin, left: margin, right: margin },
          },
        },
        children,
      },
    ],
  });
  return new Uint8Array(await (await Packer.toBlob(document_)).arrayBuffer());
}
