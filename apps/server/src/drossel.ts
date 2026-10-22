/** Hoechstzahl gleichzeitiger Aufrufe oben, je Anfrage und je Erneuerung. */
export const GLEICHZEITIG = 8;

/** Fuehrt die Aufgaben mit hoechstens `breite` gleichzeitig aus, die Reihenfolge der Ergebnisse bleibt. */
export async function gedrosselt<T>(aufgaben: (() => Promise<T>)[], breite: number): Promise<PromiseSettledResult<T>[]> {
  const ergebnisse: PromiseSettledResult<T>[] = new Array(aufgaben.length);
  let naechste = 0;
  async function arbeiter(): Promise<void> {
    while (naechste < aufgaben.length) {
      const nummer = naechste++;
      try {
        ergebnisse[nummer] = { status: "fulfilled", value: await aufgaben[nummer]!() };
      } catch (grund) {
        ergebnisse[nummer] = { status: "rejected", reason: grund };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(breite, aufgaben.length) }, arbeiter));
  return ergebnisse;
}
