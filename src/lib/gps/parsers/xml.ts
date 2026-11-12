import { XMLParser } from "fast-xml-parser";
import { GpsImportError } from "@/lib/gps/errors";

/** Elements that repeat in GPX and TCX, so they are always read as arrays. */
const REPEATED = new Set(["trk", "trkseg", "trkpt", "Activity", "Lap", "Track", "Trackpoint"]);

/**
 * Decodes bytes as text, honouring a UTF-8 or UTF-16 byte-order mark.
 * Invalid byte sequences become U+FFFD rather than throwing.
 */
export function decodeText(bytes: Uint8Array) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  return new TextDecoder("utf-8").decode(bytes.subarray(start));
}

/** The name of the document's root element, skipping the declaration, comments and whitespace. */
export function rootElementName(text: string): string | null {
  let index = 0;
  const length = Math.min(text.length, 64 * 1024);
  while (index < length) {
    const open = text.indexOf("<", index);
    if (open < 0 || open >= length) return null;
    const next = text[open + 1];
    if (next === "?") {
      const close = text.indexOf("?>", open);
      if (close < 0) return null;
      index = close + 2;
      continue;
    }
    if (text.startsWith("<!--", open)) {
      const close = text.indexOf("-->", open);
      if (close < 0) return null;
      index = close + 3;
      continue;
    }
    if (next === "!") return "!";
    const match = /^<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)/.exec(text.slice(open, open + 200));
    return match ? match[2] : null;
  }
  return null;
}

/**
 * Parses XML safely. GPS files never need a DTD, so any document type or
 * entity declaration is refused outright: this rules out external entities
 * (XXE) and entity-expansion attacks before the parser sees the text. Entity
 * processing is also switched off in the parser itself.
 */
export function parseXml(text: string): Record<string, unknown> {
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) {
    throw new GpsImportError(
      "unsupported_format",
      "The file contains a document type declaration. GPS files don't use them, so it was rejected for safety.",
    );
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: false,
    htmlEntities: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    trimValues: true,
    maxNestedTags: 64,
    isArray: (tagName) => REPEATED.has(tagName),
  });
  try {
    return parser.parse(text, true) as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : "";
    throw new GpsImportError("corrupted_file", `The file isn't well-formed XML${detail ? ` (${detail})` : ""}.`);
  }
}
