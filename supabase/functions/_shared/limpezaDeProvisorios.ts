/** ── Qual provisorio do banco e fantasma ─────────────────────────────────────────────────────
 *
 *  O fechamento apaga o provisorio que o `historical` da BRAPI nao confirma. A ideia e tirar o
 *  dia sem pregao que a rodada horaria gravou (feriado so da B3, que o calendario bancario nao
 *  pega). Ate 11/09/2026 o criterio era so esse: "nao veio no historico, some".
 *
 *  O furo: o historico nao chega completo. A rodada de 10/09/2026 as 19:15 recebeu 11/08 a
 *  08/09 E a barra ao vivo de 10/09, mas NAO 09/09, que foi pregao normal. Hoje (11/09, 12h) a
 *  mesma consulta ja traz 09/09. A provisoria de 09/09 foi apagada como fantasma nos 7 papeis
 *  sincronizados, e o motor passou a repetir o preco de 08/09 nesse dia. A prova esta no `xmin`:
 *  uma so transacao por papel gravou 11/08 a 10/09, com 10/09 provisoria e sem 09/09.
 *
 *  "So apagar se o historico ja cobre datas posteriores" NAO bastaria: naquela rodada ele cobria
 *  10/09. Mas cobria com a barra de HOJE, que a BRAPI anexa ao vivo e que nao diz nada sobre a
 *  consolidacao dos dias anteriores. Entao a cobertura conta so barra OFICIAL - nem a de hoje,
 *  nem a herdada (copia da anterior), que tambem nao e pregao.
 *
 *  Regra: um provisorio sem confirmacao so e fantasma se o historico tem barra oficial DEPOIS
 *  dele. Sem isso, ele fica, marcado como provisorio, e a janela de um mes decide na proxima
 *  rodada. O custo e o fantasma de feriado viver um ou dois pregoes a mais, com a marca; o
 *  contrario era apagar pregao de verdade.
 *
 *  O que continua sem protecao: buraco no MEIO da parte consolidada (08 e 10 oficiais, 09
 *  ausente). Nao ha como distinguir isso de feriado so olhando a fonte; a janela de um mes
 *  regrava a barra quando a fonte a devolver. */
export function provisoriosFantasmas(
  provisoriosNoBanco: string[],
  historico: { data: string; provisorio: boolean }[],
): { apagar: string[]; mantidos: string[] } {
  const confirmados = new Set(historico.map((b) => b.data));
  const coberturaOficial = historico
    .filter((b) => !b.provisorio)
    .reduce<string | null>((max, b) => (max === null || b.data > max ? b.data : max), null);

  const apagar: string[] = [];
  const mantidos: string[] = [];
  for (const d of provisoriosNoBanco) {
    if (confirmados.has(d)) continue;
    if (coberturaOficial !== null && d < coberturaOficial) apagar.push(d);
    else mantidos.push(d);
  }
  return { apagar, mantidos };
}
