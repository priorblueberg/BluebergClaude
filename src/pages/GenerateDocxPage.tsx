import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
} from "docx";
import { saveAs } from "file-saver";

const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function p(text: string, opts?: { bold?: boolean }) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, bold: opts?.bold, size: 24, font: "Arial" })],
  });
}

function heading1(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text, bold: true, size: 32, font: "Arial" })],
  });
}

function heading2(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 160 },
    children: [new TextRun({ text, bold: true, size: 28, font: "Arial" })],
  });
}

function buildDocument(): Document {
  const colWidths = [3000, 6026];
  return new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 24 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, font: "Arial" }, paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 28, bold: true, font: "Arial" }, paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 } },
      ],
    },
    sections: [
      {
        properties: {
          page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
        },
        children: [
          // Title
          new Paragraph({ spacing: { before: 2000 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "BLUEBERG", bold: true, size: 56, font: "Arial", color: "1a3a5c" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: "Regras de Negócio: Controle de Carteiras", size: 32, font: "Arial", color: "1a3a5c" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [new TextRun({ text: "Versão 1.0 — Abril 2026", size: 24, font: "Arial", color: "666666" })] }),

          // 14.1 Visão Geral
          heading1("14. Página: Controle de Carteiras (Admin)"),

          heading2("14.1 Visão Geral"),
          p("Exibe as carteiras criadas automaticamente pelo motor de sincronização."),
          p("Rota: /controle-carteiras", { bold: true }),
          p("Acesso: Apenas admin", { bold: true }),

          // 14.2 Colunas
          heading2("14.2 Colunas"),
          p("A tabela exibe as seguintes colunas:"),

          new Table({
            width: { size: 9026, type: WidthType.DXA },
            columnWidths: colWidths,
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    borders: cellBorders, width: { size: colWidths[0], type: WidthType.DXA },
                    shading: { fill: "1a3a5c", type: ShadingType.CLEAR }, margins: cellMargins,
                    children: [new Paragraph({ children: [new TextRun({ text: "Coluna", bold: true, size: 22, font: "Arial", color: "FFFFFF" })] })],
                  }),
                  new TableCell({
                    borders: cellBorders, width: { size: colWidths[1], type: WidthType.DXA },
                    shading: { fill: "1a3a5c", type: ShadingType.CLEAR }, margins: cellMargins,
                    children: [new Paragraph({ children: [new TextRun({ text: "Descrição", bold: true, size: 22, font: "Arial", color: "FFFFFF" })] })],
                  }),
                ],
              }),
              ...([
                ["Nome da Carteira", 'Nome da categoria ou "Investimentos" (geral)'],
                ["Data Início", "Menor data de início entre os ativos"],
                ["Data Limite", "Maior data limite entre os ativos"],
                ["Resgate Total", "Soma dos resgates totais"],
                ["Data Cálculo", "Data de referência usada no último cálculo"],
                ["Status", "Ativa / Encerrada / Não Iniciada"],
              ] as [string, string][]).map(([col, desc], i) =>
                new TableRow({
                  children: [
                    new TableCell({
                      borders: cellBorders, width: { size: colWidths[0], type: WidthType.DXA },
                      shading: i % 2 === 0 ? { fill: "F2F7FB", type: ShadingType.CLEAR } : undefined,
                      margins: cellMargins,
                      children: [new Paragraph({ children: [new TextRun({ text: col, bold: true, size: 22, font: "Arial" })] })],
                    }),
                    new TableCell({
                      borders: cellBorders, width: { size: colWidths[1], type: WidthType.DXA },
                      shading: i % 2 === 0 ? { fill: "F2F7FB", type: ShadingType.CLEAR } : undefined,
                      margins: cellMargins,
                      children: [new Paragraph({ children: [new TextRun({ text: desc, size: 22, font: "Arial" })] })],
                    }),
                  ],
                })
              ),
            ],
          }),
        ],
      },
    ],
  });
}

export default function GenerateDocxPage() {
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const doc = buildDocument();
      const blob = await Packer.toBlob(doc);
      saveAs(blob, "Blueberg_Controle_de_Carteiras.docx");
    } catch (e) {
      console.error(e);
      alert("Erro ao gerar documento.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Gerar Documento — Controle de Carteiras</h1>
        <p className="text-muted-foreground">Clique para baixar o .docx com as regras de negócio do Controle de Carteiras.</p>
        <Button onClick={handleGenerate} disabled={generating} size="lg">
          {generating ? "Gerando..." : "Baixar Blueberg_Controle_de_Carteiras.docx"}
        </Button>
      </div>
    </div>
  );
}
