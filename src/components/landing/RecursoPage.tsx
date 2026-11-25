import type { ElementType, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import InstitucionalLayout, { PAGINAS_DE_RECURSOS } from "./InstitucionalLayout";

export interface Destaque {
  icon: ElementType;
  titulo: string;
  texto: string;
}

export interface Secao {
  titulo: string;
  texto: string;
  itens: string[];
  visual: ReactNode;
}

interface RecursoPageProps {
  rotulo: string;
  titulo: ReactNode;
  subtitulo: string;
  destaques: Destaque[];
  secoes: Secao[];
}

/**
 * Molde das paginas de recursos do institucional: abertura, faixa de destaques, secoes alternando
 * texto e ilustracao, e no fim os atalhos para as outras paginas. Nada de abertura de conta.
 */
const RecursoPage = ({ rotulo, titulo, subtitulo, destaques, secoes }: RecursoPageProps) => {
  const { pathname } = useLocation();
  const outras = PAGINAS_DE_RECURSOS.filter((p) => p.to !== pathname);

  return (
    <InstitucionalLayout>
      {/* Abertura */}
      <section className="bg-gradient-to-b from-[#f7f9fc] to-white">
        <div className="max-w-4xl mx-auto px-6 pt-20 pb-16 lg:pt-24 text-center">
          <span className="inline-block rounded-full bg-[#0a5eb8]/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#0a5eb8]">
            {rotulo}
          </span>
          <h1 className="mt-6 text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#0a2540]">
            {titulo}
          </h1>
          <p className="mt-6 text-lg md:text-xl text-[#4a6580] leading-relaxed">{subtitulo}</p>
        </div>
      </section>

      {/* Destaques */}
      <section className="pb-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className={`grid gap-6 md:grid-cols-2 ${destaques.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            {destaques.map((d) => (
              <div key={d.titulo} className="rounded-2xl border border-[#e6ecf1] bg-white p-7">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[#0a5eb8]/10">
                  <d.icon className="h-5 w-5 text-[#0a5eb8]" />
                </div>
                <h3 className="mb-2 font-semibold text-[#0a2540]">{d.titulo}</h3>
                <p className="text-sm leading-relaxed text-[#4a6580]">{d.texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Secoes */}
      {secoes.map((s, i) => (
        <section key={s.titulo} className={i % 2 === 0 ? "py-20" : "bg-[#f7f9fc] py-20"}>
          <div className="max-w-7xl mx-auto px-6">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div className={i % 2 === 1 ? "lg:order-2" : ""}>
                <h2 className="text-3xl font-bold text-[#0a2540]">{s.titulo}</h2>
                <p className="mt-4 text-lg leading-relaxed text-[#4a6580]">{s.texto}</p>
                <ul className="mt-6 space-y-3">
                  {s.itens.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-[#4a6580]">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0a5eb8]" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={i % 2 === 1 ? "lg:order-1" : ""}>{s.visual}</div>
            </div>
          </div>
        </section>
      ))}

      {/* Outras paginas */}
      <section className="bg-[#0a2540] py-20">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-center text-3xl font-bold text-white">Conheça os outros recursos</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {outras.slice(0, 3).map((p) => (
              <Link
                key={p.to}
                to={p.to}
                className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-6 py-5 text-white transition-colors hover:bg-white/10"
              >
                <span className="font-semibold">{p.label}</span>
                <ArrowRight className="h-5 w-5 text-[#53b4e8] transition-transform group-hover:translate-x-1" />
              </Link>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Link to="/auth">
              <Button
                size="lg"
                className="h-14 rounded-full bg-[#0a5eb8] px-10 text-base font-semibold text-white hover:bg-[#084a92]"
              >
                Entrar na plataforma
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </InstitucionalLayout>
  );
};

export default RecursoPage;

/* ---------- Pecas das ilustracoes ---------- */

/** Janela de app estilizada. Os numeros dentro dela sao ilustrativos, e o rodape diz isso. */
export const Painel = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <div className="overflow-hidden rounded-2xl border border-[#e6ecf1] bg-white shadow-2xl shadow-[#0a5eb8]/10">
    <div className="flex items-center gap-2 border-b border-[#e6ecf1] bg-[#f7f9fc] px-4 py-3">
      <span className="h-2.5 w-2.5 rounded-full bg-[#d1dbe6]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#d1dbe6]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#d1dbe6]" />
      <span className="ml-3 text-xs font-medium text-[#4a6580]">{titulo}</span>
    </div>
    <div className="p-5">{children}</div>
    <p className="border-t border-[#e6ecf1] px-5 py-2 text-[10px] text-[#8da4bf]">Valores ilustrativos</p>
  </div>
);

/** Tabela compacta para as ilustracoes: primeira coluna a esquerda, as demais a direita. */
export const TabelaIlustrativa = ({ cabecalho, linhas }: { cabecalho: string[]; linhas: string[][] }) => (
  <table className="w-full text-xs">
    <thead>
      <tr className="text-[#8da4bf]">
        {cabecalho.map((c, i) => (
          <th key={c} className={`pb-2 font-medium ${i === 0 ? "text-left" : "text-right"}`}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {linhas.map((l) => (
        <tr key={l[0]} className="border-t border-[#eef2f6]">
          {l.map((v, i) => (
            <td
              key={i}
              className={`py-2.5 tabular-nums ${i === 0 ? "text-left font-medium text-[#0a2540]" : "text-right text-[#4a6580]"}`}
            >
              {v}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

/** Grafico de linha em SVG, so para ilustrar: carteira contra um benchmark. */
export const LinhasIlustrativas = ({
  serieA,
  serieB,
  legendaA,
  legendaB,
}: {
  serieA: number[];
  serieB: number[];
  legendaA: string;
  legendaB: string;
}) => {
  const todos = [...serieA, ...serieB];
  const min = Math.min(...todos);
  const max = Math.max(...todos);
  const pontos = (s: number[]) =>
    s.map((v, i) => `${(i / (s.length - 1)) * 300},${110 - ((v - min) / (max - min || 1)) * 100}`).join(" ");
  return (
    <div>
      <svg viewBox="0 0 300 120" className="h-40 w-full" preserveAspectRatio="none">
        {[10, 43, 76, 110].map((y) => (
          <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="#eef2f6" strokeWidth="1" />
        ))}
        <polyline points={pontos(serieB)} fill="none" stroke="#8da4bf" strokeWidth="2" strokeDasharray="4 4" />
        <polyline points={pontos(serieA)} fill="none" stroke="#0a5eb8" strokeWidth="2.5" />
      </svg>
      <div className="mt-3 flex gap-5 text-xs text-[#4a6580]">
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-4 bg-[#0a5eb8]" /> {legendaA}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-4 border-t-2 border-dashed border-[#8da4bf]" /> {legendaB}
        </span>
      </div>
    </div>
  );
};
