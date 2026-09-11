/**
 * Lingueta cinza que mostra até quando vai o dado de uma linha ou de uma carteira, quando ele não
 * chega à data global (ex.: o fundo com a última cota em 09/09 e a data global em 11/09).
 *
 * Pedido do Daniel em 11/09/2026, "pelo menos por hora", para facilitar a validação do período.
 */
const dataCurta = (iso: string, dataGlobal?: string | null) => {
  const [ano, mes, dia] = iso.split("-");
  return dataGlobal && dataGlobal.slice(0, 4) === ano ? `${dia}/${mes}` : `${dia}/${mes}/${ano}`;
};

export default function LinguetaDeData({ data, dataGlobal }: { data: string | null | undefined; dataGlobal?: string | null }) {
  if (!data) return null;
  const [ano, mes, dia] = data.split("-");
  return (
    <span
      className="ml-2 inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-muted px-2 py-0.5 align-middle text-[10px] font-medium text-muted-foreground"
      title={`Último dado divulgado em ${dia}/${mes}/${ano}`}
    >
      até {dataCurta(data, dataGlobal)}
    </span>
  );
}
