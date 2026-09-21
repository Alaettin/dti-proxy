/**
 * Die Antwortform fuer Fehler aus der AAS-Spezifikation (Result). Die Texte sind
 * englisch, weil sie nach aussen gehen; die Oberflaeche ist deutsch.
 */
export type NachrichtenTyp = "Error" | "Warning" | "Info" | "Exception";

export interface Nachricht {
  code: string;
  messageType: NachrichtenTyp;
  text: string;
  timestamp: string;
}

export interface Ergebnis {
  messages: Nachricht[];
}

export type Uhr = () => Date;

export const echteUhr: Uhr = () => new Date();

export function nachricht(code: string, text: string, typ: NachrichtenTyp = "Error", uhr: Uhr = echteUhr): Nachricht {
  return { code, messageType: typ, text, timestamp: uhr().toISOString() };
}

export function ergebnis(code: string, text: string, typ: NachrichtenTyp = "Error", uhr: Uhr = echteUhr): Ergebnis {
  return { messages: [nachricht(code, text, typ, uhr)] };
}

export function ergebnisAus(code: string, texte: string[], typ: NachrichtenTyp = "Error", uhr: Uhr = echteUhr): Ergebnis {
  return { messages: texte.map((text) => nachricht(code, text, typ, uhr)) };
}
