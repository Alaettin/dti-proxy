import crypto from "node:crypto";
import type { Request, Response } from "express";

export const COOKIE_NAME = "dti_proxy_sitzung";
const GUELTIG_MS = 12 * 60 * 60 * 1000;

/**
 * Vergleicht ohne Laufzeitverrat und ohne an unterschiedlichen Laengen zu
 * scheitern: beide Seiten werden erst auf 32 Byte gehasht.
 */
export function gleich(a: string, b: string): boolean {
  const links = crypto.createHash("sha256").update(a).digest();
  const rechts = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(links, rechts);
}

function unterschrift(nutzlast: string, geheimnis: string): string {
  return crypto.createHmac("sha256", geheimnis).update(nutzlast).digest("base64url");
}

export function cookieLesen(req: Request, name: string): string | undefined {
  const zeile = req.headers.cookie;
  if (!zeile) return undefined;
  for (const teil of zeile.split(";")) {
    const trenner = teil.indexOf("=");
    if (trenner === -1) continue;
    if (teil.slice(0, trenner).trim() !== name) continue;
    return decodeURIComponent(teil.slice(trenner + 1).trim());
  }
  return undefined;
}

export function sitzungSetzen(res: Response, benutzer: string, geheimnis: string, sicher: boolean): void {
  const nutzlast = Buffer.from(JSON.stringify({ benutzer, bis: Date.now() + GUELTIG_MS }), "utf8").toString(
    "base64url",
  );
  const wert = `${nutzlast}.${unterschrift(nutzlast, geheimnis)}`;
  res.cookie(COOKIE_NAME, wert, {
    httpOnly: true,
    sameSite: "lax",
    secure: sicher,
    maxAge: GUELTIG_MS,
    path: "/",
  });
}

export function sitzungLoeschen(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function sitzungPruefen(req: Request, geheimnis: string): string | null {
  const wert = cookieLesen(req, COOKIE_NAME);
  if (!wert) return null;
  const trenner = wert.lastIndexOf(".");
  if (trenner === -1) return null;
  const nutzlast = wert.slice(0, trenner);
  const gegeben = wert.slice(trenner + 1);
  if (!gleich(gegeben, unterschrift(nutzlast, geheimnis))) return null;
  try {
    const inhalt = JSON.parse(Buffer.from(nutzlast, "base64url").toString("utf8")) as {
      benutzer?: unknown;
      bis?: unknown;
    };
    if (typeof inhalt.benutzer !== "string" || typeof inhalt.bis !== "number") return null;
    if (inhalt.bis < Date.now()) return null;
    return inhalt.benutzer;
  } catch {
    return null;
  }
}
