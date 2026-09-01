/**
 * Período de análise, na convenção do Gorila.
 *
 * Antes o app tinha uma data só ("Posição em"), e o início da janela era sempre a primeira
 * aplicação da carteira. Agora as duas pontas são escolhidas, como no Gorila: os mesmos
 * atalhos (30 dias, 12 meses, mês/ano atual, mês/ano anterior, desde o início) mais um
 * intervalo livre.
 *
 * O teto é **D0**, o dia corrente, igual ao Gorila. Já foi D-1; virou D0 para que os dois
 * lados possam ser comparados na mesma data sem manobra. Quando falta cotação do dia, os
 * motores repetem a do dia anterior, que é o que ele faz.
 */

export type PresetPeriodo =
  | "30d"
  | "12m"
  | "mesAtual"
  | "anoAtual"
  | "mesAnterior"
  | "anoAnterior"
  | "inicio"
  | "custom";

export interface Periodo {
  /** null = "desde o início": cada lâmina usa o começo da própria carteira. */
  inicio: string | null;
  fim: string;
  preset: PresetPeriodo;
}

export const ROTULO_PRESET: Record<PresetPeriodo, string> = {
  "30d": "30 dias",
  "12m": "12 meses",
  mesAtual: "Mês atual",
  anoAtual: "Ano atual",
  mesAnterior: "Mês anterior",
  anoAnterior: "Ano anterior",
  inicio: "Desde o início",
  custom: "Personalizado",
};

/** Ordem do menu, igual à do Gorila. */
export const PRESETS: PresetPeriodo[] = [
  "30d", "12m", "mesAtual", "anoAtual", "mesAnterior", "anoAnterior", "inicio",
];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** D0: o teto de qualquer seleção é o dia corrente, como no Gorila. */
export function limiteISO(hoje = new Date()): string {
  return iso(hoje);
}

export function paraDate(s: string): Date {
  return new Date(s + "T12:00:00");
}

/**
 * Resolve um atalho em intervalo, sempre terminando no máximo em D0.
 *
 * Os atalhos de calendário (mês/ano) são ancorados em HOJE: medido no Gorila em
 * 01/09/2026, "Mês anterior" deu 01/08 - 31/08 e "30 dias" deu 02/08 - 01/09.
 */
export function periodoDoPreset(preset: PresetPeriodo, hoje = new Date()): Periodo {
  const teto = limiteISO(hoje);
  const t = paraDate(teto);
  const y = hoje.getFullYear();
  const m = hoje.getMonth();
  const menor = (a: string, b: string) => (a < b ? a : b);

  switch (preset) {
    case "30d": {
      const de = new Date(t);
      de.setDate(de.getDate() - 30);
      return { inicio: iso(de), fim: teto, preset };
    }
    case "12m": {
      const de = new Date(t);
      de.setFullYear(de.getFullYear() - 1);
      return { inicio: iso(de), fim: teto, preset };
    }
    case "mesAtual":
      return { inicio: iso(new Date(y, m, 1)), fim: teto, preset };
    case "anoAtual":
      return { inicio: iso(new Date(y, 0, 1)), fim: teto, preset };
    case "mesAnterior":
      return {
        inicio: iso(new Date(y, m - 1, 1)),
        fim: menor(iso(new Date(y, m, 0)), teto), // dia 0 do mês corrente = último do anterior
        preset,
      };
    case "anoAnterior":
      return { inicio: iso(new Date(y - 1, 0, 1)), fim: menor(iso(new Date(y - 1, 11, 31)), teto), preset };
    case "inicio":
    default:
      return { inicio: null, fim: teto, preset: "inicio" };
  }
}

export function periodoPadrao(hoje = new Date()): Periodo {
  return periodoDoPreset("inicio", hoje);
}

export function fmtBR(s: string | null): string {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

/** "dd/mm/aaaa" -> ISO, ou null se não for data válida. */
export function deBR(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mm, y] = m;
  const dt = new Date(Number(y), Number(mm) - 1, Number(d));
  if (dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(mm) - 1 || dt.getDate() !== Number(d)) return null;
  return `${y}-${mm}-${d}`;
}

/**
 * Recorta a janela pedida pelo que a carteira consegue responder.
 *
 * O Gorila faz o mesmo: pedir um `startDate` anterior ao início do portfólio devolve o
 * início do portfólio. O fim NÃO é recortado pelo fim da carteira: uma carteira encerrada
 * dentro da janela continua no histórico, com patrimônio zero e o ganho preservado.
 */
export function janelaDaLamina(
  periodo: Periodo,
  inicioDaCarteira: string | null,
): { inicio: string; fim: string } | null {
  if (!inicioDaCarteira) return null;
  const inicio = !periodo.inicio || periodo.inicio < inicioDaCarteira ? inicioDaCarteira : periodo.inicio;
  if (inicio > periodo.fim) return null;
  return { inicio, fim: periodo.fim };
}

export interface CarteiraComJanela {
  data_inicio: string | null;
  data_calculo: string | null;
}

/**
 * Reescreve a carteira com a janela do período escolhido.
 *
 * `data_inicio` deixa de ser "a primeira aplicação" e passa a ser o começo da janela;
 * `data_calculo` deixa de ser o carimbo do último recálculo e passa a ser o fim da janela.
 * Com isso rótulo, gráfico, tabela e cards seguem o seletor sem que cada tela precise saber
 * do período.
 *
 * O fim NÃO é recortado pelo horizonte de mercado: quando falta cotação, os motores repetem
 * a do dia anterior (`ultimaCota` no fundo, `prevCdiDiario` na renda fixa), que é o que o
 * Gorila faz. Isso aposenta o clamp por `horizonte_de_mercado`.
 */
export function aplicarJanela<T extends CarteiraComJanela>(
  cart: T | null | undefined,
  periodo: Periodo,
): T | null {
  if (!cart || !cart.data_inicio) return cart ?? null;
  const j = janelaDaLamina(periodo, cart.data_inicio);
  if (!j) return { ...cart, data_calculo: null };
  return { ...cart, data_inicio: j.inicio, data_calculo: j.fim };
}

/**
 * O período vai na URL para sobreviver a um reload e poder ser compartilhado.
 *
 * `p` guarda o atalho e `de`/`ate` as datas resolvidas. Ao ler de volta: se o atalho ainda
 * resolve nas MESMAS datas (mesmo dia), volta como atalho, e o botão mostra "Mês anterior";
 * se não resolve (link aberto noutro dia), as datas mandam e vira "Personalizado". Assim uma
 * URL sempre reproduz o período que estava na tela de quem a gerou.
 */
export function periodoParaQuery(p: Periodo): { p: string; de?: string; ate: string } {
  return { p: p.preset, ...(p.inicio ? { de: p.inicio } : {}), ate: p.fim };
}

export function periodoDeQuery(params: URLSearchParams, hoje = new Date()): Periodo | null {
  const preset = params.get("p");
  const de = params.get("de");
  const ate = params.get("ate");
  if (!ate) return null;
  if (!preset || preset === "custom" || !PRESETS.includes(preset as PresetPeriodo)) {
    return de ? { inicio: de, fim: ate, preset: "custom" } : null;
  }
  const resolvido = periodoDoPreset(preset as PresetPeriodo, hoje);
  const mesmasDatas = resolvido.fim === ate && (resolvido.inicio ?? "") === (de ?? "");
  return mesmasDatas ? resolvido : { inicio: de ?? null, fim: ate, preset: "custom" };
}
