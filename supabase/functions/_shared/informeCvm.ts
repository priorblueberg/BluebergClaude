/**
 * Leitura dos arquivos da CVM: cadastro de fundos e informe diario de cotas.
 *
 * Compartilhado entre `cadastrar-fundo` (cadastro por CNPJ e carga no modal) e
 * `carga-cotas-fundo` (carga em segundo plano disparada pela boleta). Os dois leem o mesmo
 * informe do mesmo jeito, e o jeito tem tres detalhes que ja custaram caro - o zip remoto lido
 * por faixa, o filtro por substring antes do parse e o orcamento de tempo. Duas copias disso
 * divergiriam no primeiro ajuste.
 */

/** Data inicial da ferramenta. Nenhuma serie de cota comeca antes dela. */
export const PISO_SERIE = "2023-01-02";

/**
 * Orcamento de uma chamada, em milissegundos de relogio.
 *
 * Era um teto FIXO de 12 meses, e ele nao cabe: cada informe diario da CVM traz todos os fundos
 * do pais no mes, e descompactar e varrer um so ja consome segundos de CPU. Doze numa chamada
 * mata o worker com "CPU Time exceeded" - medido em 10/09/2026.
 *
 * O teto e TEMPO, nao contagem: processa meses ate o orcamento acabar e devolve o proximo
 * pendente. 2,5s e conservador de proposito: o worker morre por volta de 5s de CPU (medido nos
 * logs), e a verificacao so acontece ENTRE meses - uma chamada que comeca um mes pesado com 2,4s
 * no relogio ainda precisa termina-lo.
 */
export const ORCAMENTO_MS = 2500;
/** Teto de seguranca: mesmo sobrando tempo, nao vale segurar a resposta indefinidamente. */
export const MAX_MESES = 6;

export const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
export const competencia = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;

export function campo(linha: string, n: number): string {
  let ini = 0;
  for (let k = 0; k < n; k++) { const p = linha.indexOf(";", ini); if (p < 0) return ""; ini = p + 1; }
  const fim = linha.indexOf(";", ini);
  return fim < 0 ? linha.slice(ini) : linha.slice(ini, fim);
}

async function faixa(url: string, range: string): Promise<Response> {
  const r = await fetch(url, { headers: { Range: range } });
  if (r.status !== 206 && r.status !== 200) throw new Error(`Range ${range} HTTP ${r.status}`);
  return r;
}

/**
 * Abre um membro de um zip REMOTO sem baixar o arquivo inteiro.
 *
 * O cadastro da CVM tem 6,7 MB comprimidos e 44 MB de csv; materializar isso estoura a memoria
 * da edge function. Aqui se le o rodape (diretorio central) por Range, acha-se o offset do
 * membro e pede-se so a faixa de bytes dele, direto no DecompressionStream.
 */
export async function membroRemoto(
  url: string,
  escolher: (nome: string) => boolean,
): Promise<ReadableStream<string>> {
  const rodape = new Uint8Array(await (await faixa(url, "bytes=-4096")).arrayBuffer());
  const dvR = new DataView(rodape.buffer, rodape.byteOffset, rodape.byteLength);
  let e = rodape.length - 22;
  while (e >= 0 && dvR.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("zip sem diretorio central");
  const cdTam = dvR.getUint32(e + 12, true);
  const cdIni = dvR.getUint32(e + 16, true);

  const cd = new Uint8Array(await (await faixa(url, `bytes=${cdIni}-${cdIni + cdTam - 1}`)).arrayBuffer());
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  let p = 0;
  while (p < cd.length && dv.getUint32(p, true) === 0x02014b50) {
    const nomeLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const comLen = dv.getUint16(p + 32, true);
    const metodo = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const offsetLocal = dv.getUint32(p + 42, true);
    const nome = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nomeLen));
    if (escolher(nome)) {
      if (metodo !== 8) throw new Error(`${nome}: membro nao esta em deflate`);
      const cab = new Uint8Array(await (await faixa(url, `bytes=${offsetLocal}-${offsetLocal + 29}`)).arrayBuffer());
      const dvC = new DataView(cab.buffer, cab.byteOffset, cab.byteLength);
      const inicio = offsetLocal + 30 + dvC.getUint16(26, true) + dvC.getUint16(28, true);
      const corpo = await faixa(url, `bytes=${inicio}-${inicio + csize - 1}`);
      return corpo.body!
        .pipeThrough(new DecompressionStream("deflate-raw"))
        .pipeThrough(new TextDecoderStream("iso-8859-1")) as ReadableStream<string>;
    }
    p += 46 + nomeLen + extraLen + comLen;
  }
  throw new Error("membro nao encontrado no zip");
}

/** Percorre um csv da CVM linha a linha, sem materializar o arquivo inteiro. */
export async function percorrerCsv(
  stream: ReadableStream<string>,
  aoLer: (linha: string, idx: Map<string, number>) => void,
) {
  let resto = "";
  let idx: Map<string, number> | null = null;
  for await (const pedaco of stream as unknown as AsyncIterable<string>) {
    const partes = (resto + pedaco).split("\n");
    resto = partes.pop() ?? "";
    for (const linha of partes) {
      if (!idx) {
        idx = new Map(linha.replace(/\r$/, "").split(";").map((c, i) => [c.trim().toUpperCase(), i] as const));
        continue;
      }
      aoLer(linha.replace(/\r$/, ""), idx);
    }
  }
  if (resto && idx) aoLer(resto.replace(/\r$/, ""), idx);
}

export type CotaMes = { subclasse: string; data: string; cota: number };

/** As cotas de UM fundo num mes do informe diario. `[]` quando o mes ainda nao foi publicado. */
export async function cotasDoMes(mes: string, cnpj: string): Promise<CotaMes[]> {
  const url = `https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_${mes}.zip`;
  // 404 = mes ainda nao publicado (normal nos primeiros dias); nao e erro.
  const cabeca = await fetch(url, { method: "HEAD" });
  if (cabeca.status === 404) return [];
  const stream = await membroRemoto(url, (n) => n.toLowerCase().endsWith(".csv"));

  // O filtro barato vem primeiro. O informe traz TODOS os fundos do pais (121 mil linhas num mes
  // parcial, ~370 mil num cheio), e extrair o campo e limpar a pontuacao de cada linha para
  // descartar 99,99% era o que matava a funcao por CPU. O CNPJ vem pontuado no arquivo, entao se
  // procura a string inteira na linha crua, e so as poucas que passam pagam o parse.
  const marca = cnpj.length === 14
    ? `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`
    : null;

  const achados: CotaMes[] = [];
  await percorrerCsv(stream, (linha, idx) => {
    if (marca && linha.indexOf(marca) < 0) return;
    const iCnpj = idx.get("CNPJ_FUNDO_CLASSE") ?? idx.get("CNPJ_FUNDO") ?? -1;
    const iData = idx.get("DT_COMPTC") ?? -1;
    const iCota = idx.get("VL_QUOTA") ?? -1;
    const iSub = idx.get("ID_SUBCLASSE") ?? -1;
    if (iCnpj < 0 || iData < 0 || iCota < 0) return;
    // A conferencia exata fica: a marca acha a substring em qualquer coluna.
    if (soDigitos(campo(linha, iCnpj)) !== cnpj) return;
    const cota = parseFloat(campo(linha, iCota));
    if (!Number.isFinite(cota) || cota <= 0) return;
    const data = campo(linha, iData).trim();
    // O piso ja vem da escolha dos meses, que nunca comeca antes de 01/2023. Esta conferencia e
    // por linha, para o piso nao depender de o arquivo do mes trazer so datas daquele mes.
    if (data < PISO_SERIE) return;
    achados.push({
      subclasse: iSub >= 0 ? campo(linha, iSub).trim() : "",
      data,
      cota,
    });
  });
  return achados;
}

/** Os meses a varrer a partir de `inicioISO`, ate hoje e ate `MAX_MESES`, e o que sobra depois. */
export function mesesAPartirDe(inicioISO: string): { meses: string[]; depoisDaLista: string | null } {
  const cursor = new Date(inicioISO + "T00:00:00");
  const hoje = new Date();
  const meses: string[] = [];
  while (cursor <= hoje && meses.length < MAX_MESES) {
    meses.push(competencia(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
    cursor.setDate(1);
  }
  return { meses, depoisDaLista: cursor <= hoje ? competencia(cursor) : null };
}
