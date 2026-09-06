import { describe, it, expect } from "vitest";
import { inicioDaSerieDeMovs } from "./syncEngine";

const mov = (data: string) => ({ data });

describe("inicioDaSerieDeMovs", () => {
  it("no caso normal é a própria aplicação inicial", () => {
    const movs = [mov("2025-05-05"), mov("2026-06-03")];
    expect(inicioDaSerieDeMovs(movs, "2025-05-05")).toBe("2025-05-05");
  });

  it("resgate anterior à aplicação puxa o início para trás", () => {
    // O caso que fazia o resgate sumir do cálculo: aplicação editada para depois dele.
    const movs = [mov("2026-08-03"), mov("2026-06-03")];
    expect(inicioDaSerieDeMovs(movs, "2026-08-03")).toBe("2026-06-03");
  });

  it("vale a mais antiga entre várias", () => {
    const movs = [mov("2026-08-03"), mov("2026-06-03"), mov("2024-02-10"), mov("2025-01-01")];
    expect(inicioDaSerieDeMovs(movs, "2026-08-03")).toBe("2024-02-10");
  });

  it("sem movimentações, fica o fallback", () => {
    expect(inicioDaSerieDeMovs([], "2025-05-05")).toBe("2025-05-05");
  });

  it("movimentação sem data não derruba o cálculo", () => {
    const movs = [{ data: null }, mov("2025-03-01"), { data: undefined }];
    expect(inicioDaSerieDeMovs(movs, "2025-05-05")).toBe("2025-03-01");
  });
});
