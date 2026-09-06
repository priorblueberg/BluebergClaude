export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  // O client resolve em `invest` (db.schema em integrations/supabase/client.ts).
  // `public` neste projeto nao tem tabelas de aplicacao.
  public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  invest: {
    Tables: {
      cadastro_de_fundos: {
        Row: {
          id: string
          cnpj_classe: string
          id_registro_fundo: number | null
          id_registro_classe: number | null
          codigo_cvm: string | null
          data_registro: string | null
          data_constituicao: string | null
          data_inicio: string | null
          tipo_classe: string | null
          denominacao_social: string | null
          situacao: string | null
          data_inicio_situacao: string | null
          classificacao: string | null
          indicador_desempenho: string | null
          classe_cotas: string | null
          classificacao_anbima: string | null
          tributacao_longo_prazo: string | null
          entidade_investimento: string | null
          permitido_aplicacao_exterior_100: string | null
          classe_esg: string | null
          forma_condominio: string | null
          exclusivo: string | null
          publico_alvo: string | null
          cnpj_auditor: string | null
          auditor: string | null
          cnpj_custodiante: string | null
          custodiante: string | null
          cnpj_controlador: string | null
          controlador: string | null
          cnpj_fundo: string | null
          tipo_fundo: string | null
          cnpj_administrador: string | null
          administrador: string | null
          cpf_cnpj_gestor: string | null
          gestor: string | null
          nome_curto: string
          benchmark: string | null
          come_cotas: boolean
          taxa_administracao_aa: number | null
          dias_cotizacao_aplicacao: number
          dias_cotizacao_resgate: number
          dias_liquidacao_resgate: number
          engine: string
          ativo: boolean
          created_at: string
          cvm_id_subclasse: string | null
          sincronizar_cotas: boolean
        }
        Insert: {
          id?: string
          cnpj_classe: string
          id_registro_fundo?: number | null
          id_registro_classe?: number | null
          codigo_cvm?: string | null
          data_registro?: string | null
          data_constituicao?: string | null
          data_inicio?: string | null
          tipo_classe?: string | null
          denominacao_social?: string | null
          situacao?: string | null
          data_inicio_situacao?: string | null
          classificacao?: string | null
          indicador_desempenho?: string | null
          classe_cotas?: string | null
          classificacao_anbima?: string | null
          tributacao_longo_prazo?: string | null
          entidade_investimento?: string | null
          permitido_aplicacao_exterior_100?: string | null
          classe_esg?: string | null
          forma_condominio?: string | null
          exclusivo?: string | null
          publico_alvo?: string | null
          cnpj_auditor?: string | null
          auditor?: string | null
          cnpj_custodiante?: string | null
          custodiante?: string | null
          cnpj_controlador?: string | null
          controlador?: string | null
          cnpj_fundo?: string | null
          tipo_fundo?: string | null
          cnpj_administrador?: string | null
          administrador?: string | null
          cpf_cnpj_gestor?: string | null
          gestor?: string | null
          nome_curto: string
          benchmark?: string | null
          come_cotas?: boolean
          taxa_administracao_aa?: number | null
          dias_cotizacao_aplicacao?: number
          dias_cotizacao_resgate?: number
          dias_liquidacao_resgate?: number
          engine?: string
          ativo?: boolean
          created_at?: string
          cvm_id_subclasse?: string | null
          sincronizar_cotas?: boolean
        }
        Update: {
          id?: string
          cnpj_classe?: string
          id_registro_fundo?: number | null
          id_registro_classe?: number | null
          codigo_cvm?: string | null
          data_registro?: string | null
          data_constituicao?: string | null
          data_inicio?: string | null
          tipo_classe?: string | null
          denominacao_social?: string | null
          situacao?: string | null
          data_inicio_situacao?: string | null
          classificacao?: string | null
          indicador_desempenho?: string | null
          classe_cotas?: string | null
          classificacao_anbima?: string | null
          tributacao_longo_prazo?: string | null
          entidade_investimento?: string | null
          permitido_aplicacao_exterior_100?: string | null
          classe_esg?: string | null
          forma_condominio?: string | null
          exclusivo?: string | null
          publico_alvo?: string | null
          cnpj_auditor?: string | null
          auditor?: string | null
          cnpj_custodiante?: string | null
          custodiante?: string | null
          cnpj_controlador?: string | null
          controlador?: string | null
          cnpj_fundo?: string | null
          tipo_fundo?: string | null
          cnpj_administrador?: string | null
          administrador?: string | null
          cpf_cnpj_gestor?: string | null
          gestor?: string | null
          nome_curto?: string
          benchmark?: string | null
          come_cotas?: boolean
          taxa_administracao_aa?: number | null
          dias_cotizacao_aplicacao?: number
          dias_cotizacao_resgate?: number
          dias_liquidacao_resgate?: number
          engine?: string
          ativo?: boolean
          created_at?: string
          cvm_id_subclasse?: string | null
          sincronizar_cotas?: boolean
        }
        Relationships: []
      }
      cadastro_de_titulos: {
        Row: {
          id: string
          produto_id: string
          emissor_id: string | null
          modalidade: string
          indexador: string | null
          taxa: number
          vencimento: string
          pagamento: string
          preco_emissao: number
          nome: string
          ativo: boolean
          criado_por: string | null
          created_at: string
        }
        Insert: {
          id?: string
          produto_id: string
          emissor_id?: string | null
          modalidade: string
          indexador?: string | null
          taxa: number
          vencimento: string
          pagamento?: string
          preco_emissao?: number
          nome: string
          ativo?: boolean
          criado_por?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          produto_id?: string
          emissor_id?: string | null
          modalidade?: string
          indexador?: string | null
          taxa?: number
          vencimento?: string
          pagamento?: string
          preco_emissao?: number
          nome?: string
          ativo?: boolean
          criado_por?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadastro_de_titulos_emissor_id_fkey"
            columns: ["emissor_id"]
            isOneToOne: false
            referencedRelation: "emissores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadastro_de_titulos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          }
        ]
      }
      calendario_dias_uteis: {
        Row: {
          data: string
          dia_util: boolean
        }
        Insert: {
          data: string
          dia_util?: boolean
        }
        Update: {
          data?: string
          dia_util?: boolean
        }
        Relationships: []
      }
      calendario_ipca: {
        Row: {
          id: string
          data: string
          tipo: string
          competencia: string
          variacao_mensal: number | null
          created_at: string
        }
        Insert: {
          id?: string
          data: string
          tipo: string
          competencia: string
          variacao_mensal?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          data?: string
          tipo?: string
          competencia?: string
          variacao_mensal?: number | null
          created_at?: string
        }
        Relationships: []
      }
      categorias: {
        Row: {
          id: string
          nome: string
          ativa: boolean
          created_at: string
        }
        Insert: {
          id?: string
          nome: string
          ativa?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          nome?: string
          ativa?: boolean
          created_at?: string
        }
        Relationships: []
      }
      controle_de_carteiras: {
        Row: {
          id: string
          user_id: string
          categoria_id: string
          nome_carteira: string
          status: string | null
          data_inicio: string | null
          data_calculo: string | null
          data_limite: string | null
          resgate_total: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          categoria_id: string
          nome_carteira: string
          status?: string | null
          data_inicio?: string | null
          data_calculo?: string | null
          data_limite?: string | null
          resgate_total?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          categoria_id?: string
          nome_carteira?: string
          status?: string | null
          data_inicio?: string | null
          data_calculo?: string | null
          data_limite?: string | null
          resgate_total?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "controle_de_carteiras_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "controle_de_carteiras_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      cotas_fundos: {
        Row: {
          fundo_id: string
          data: string
          valor_cota: number
          provisorio: boolean
        }
        Insert: {
          fundo_id: string
          data: string
          valor_cota: number
          provisorio?: boolean
        }
        Update: {
          fundo_id?: string
          data?: string
          valor_cota?: number
          provisorio?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cotas_fundos_fundo_id_fkey"
            columns: ["fundo_id"]
            isOneToOne: false
            referencedRelation: "cadastro_de_fundos"
            referencedColumns: ["id"]
          }
        ]
      }
      custodia: {
        Row: {
          id: string
          user_id: string
          codigo_custodia: string | null
          categoria_id: string
          produto_id: string
          emissor_id: string | null
          instituicao_id: string | null
          nome: string | null
          tipo_movimentacao: string | null
          modalidade: string | null
          indexador: string | null
          taxa: number | null
          multiplicador: string | null
          valor_investido: number | null
          preco_unitario: number | null
          pu_inicial: number | null
          quantidade: number | null
          data_inicio: string | null
          vencimento: string | null
          data_limite: string | null
          data_calculo: string | null
          resgate_total: string | null
          pagamento: string | null
          amortizacao: number | null
          rendimentos: number | null
          alocacao_patrimonial: string | null
          estrategia: string | null
          status_variavel: string | null
          sigla_tesouro: string | null
          custodia_no_dia: boolean | null
          metadata: Json
          created_at: string
          fundo_id: string | null
          moeda: string | null
          titulo_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          codigo_custodia?: string | null
          categoria_id: string
          produto_id: string
          emissor_id?: string | null
          instituicao_id?: string | null
          nome?: string | null
          tipo_movimentacao?: string | null
          modalidade?: string | null
          indexador?: string | null
          taxa?: number | null
          multiplicador?: string | null
          valor_investido?: number | null
          preco_unitario?: number | null
          pu_inicial?: number | null
          quantidade?: number | null
          data_inicio?: string | null
          vencimento?: string | null
          data_limite?: string | null
          data_calculo?: string | null
          resgate_total?: string | null
          pagamento?: string | null
          amortizacao?: number | null
          rendimentos?: number | null
          alocacao_patrimonial?: string | null
          estrategia?: string | null
          status_variavel?: string | null
          sigla_tesouro?: string | null
          custodia_no_dia?: boolean | null
          metadata?: Json
          created_at?: string
          fundo_id?: string | null
          moeda?: string | null
          titulo_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          codigo_custodia?: string | null
          categoria_id?: string
          produto_id?: string
          emissor_id?: string | null
          instituicao_id?: string | null
          nome?: string | null
          tipo_movimentacao?: string | null
          modalidade?: string | null
          indexador?: string | null
          taxa?: number | null
          multiplicador?: string | null
          valor_investido?: number | null
          preco_unitario?: number | null
          pu_inicial?: number | null
          quantidade?: number | null
          data_inicio?: string | null
          vencimento?: string | null
          data_limite?: string | null
          data_calculo?: string | null
          resgate_total?: string | null
          pagamento?: string | null
          amortizacao?: number | null
          rendimentos?: number | null
          alocacao_patrimonial?: string | null
          estrategia?: string | null
          status_variavel?: string | null
          sigla_tesouro?: string | null
          custodia_no_dia?: boolean | null
          metadata?: Json
          created_at?: string
          fundo_id?: string | null
          moeda?: string | null
          titulo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custodia_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custodia_emissor_id_fkey"
            columns: ["emissor_id"]
            isOneToOne: false
            referencedRelation: "emissores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custodia_fundo_id_fkey"
            columns: ["fundo_id"]
            isOneToOne: false
            referencedRelation: "cadastro_de_fundos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custodia_instituicao_id_fkey"
            columns: ["instituicao_id"]
            isOneToOne: false
            referencedRelation: "instituicoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custodia_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custodia_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: false
            referencedRelation: "cadastro_de_titulos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custodia_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      dias_semana: {
        Row: {
          id: number
          sigla: string
          nome_completo: string
        }
        Insert: {
          id: number
          sigla: string
          nome_completo: string
        }
        Update: {
          id?: number
          sigla?: string
          nome_completo?: string
        }
        Relationships: []
      }
      emissores: {
        Row: {
          id: string
          nome: string
          ativo: boolean
          created_at: string
          user_id: string | null
          cnpj: string | null
          segmento: string | null
          origem: string
          nome_busca: string | null
        }
        Insert: {
          id?: string
          nome: string
          ativo?: boolean
          created_at?: string
          user_id?: string | null
          cnpj?: string | null
          segmento?: string | null
          origem?: string
          nome_busca?: string | null
        }
        Update: {
          id?: string
          nome?: string
          ativo?: boolean
          created_at?: string
          user_id?: string | null
          cnpj?: string | null
          segmento?: string | null
          origem?: string
          nome_busca?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emissores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      historico_cdi: {
        Row: {
          data: string
          taxa_anual: number
          dia_util: boolean
          provisorio: boolean
        }
        Insert: {
          data: string
          taxa_anual: number
          dia_util?: boolean
          provisorio?: boolean
        }
        Update: {
          data?: string
          taxa_anual?: number
          dia_util?: boolean
          provisorio?: boolean
        }
        Relationships: []
      }
      historico_dolar: {
        Row: {
          data: string
          cotacao_venda: number
          created_at: string
          provisorio: boolean
        }
        Insert: {
          data: string
          cotacao_venda: number
          created_at?: string
          provisorio?: boolean
        }
        Update: {
          data?: string
          cotacao_venda?: number
          created_at?: string
          provisorio?: boolean
        }
        Relationships: []
      }
      historico_euro: {
        Row: {
          data: string
          cotacao_venda: number
          created_at: string
          provisorio: boolean
        }
        Insert: {
          data: string
          cotacao_venda: number
          created_at?: string
          provisorio?: boolean
        }
        Update: {
          data?: string
          cotacao_venda?: number
          created_at?: string
          provisorio?: boolean
        }
        Relationships: []
      }
      historico_ibovespa: {
        Row: {
          data: string
          pontos: number
          provisorio: boolean
        }
        Insert: {
          data: string
          pontos: number
          provisorio?: boolean
        }
        Update: {
          data?: string
          pontos?: number
          provisorio?: boolean
        }
        Relationships: []
      }
      historico_ipca: {
        Row: {
          competencia: string
          data_referencia: string
          variacao_mensal: number
          fator_mensal: number
          data_publicacao: string | null
          created_at: string
          numero_indice: number | null
        }
        Insert: {
          competencia: string
          data_referencia: string
          variacao_mensal: number
          fator_mensal: number
          data_publicacao?: string | null
          created_at?: string
          numero_indice?: number | null
        }
        Update: {
          competencia?: string
          data_referencia?: string
          variacao_mensal?: number
          fator_mensal?: number
          data_publicacao?: string | null
          created_at?: string
          numero_indice?: number | null
        }
        Relationships: []
      }
      historico_ipca_projecao: {
        Row: {
          competencia: string
          variacao_projetada: number
          fator_projetado: number
          fonte: string | null
          created_at: string
          data_referencia: string
          data_coleta: string | null
        }
        Insert: {
          competencia: string
          variacao_projetada: number
          fator_projetado: number
          fonte?: string | null
          created_at?: string
          data_referencia: string
          data_coleta?: string | null
        }
        Update: {
          competencia?: string
          variacao_projetada?: number
          fator_projetado?: number
          fonte?: string | null
          created_at?: string
          data_referencia?: string
          data_coleta?: string | null
        }
        Relationships: []
      }
      historico_poupanca_rendimento: {
        Row: {
          data: string
          rendimento_mensal: number
          provisorio: boolean
        }
        Insert: {
          data: string
          rendimento_mensal: number
          provisorio?: boolean
        }
        Update: {
          data?: string
          rendimento_mensal?: number
          provisorio?: boolean
        }
        Relationships: []
      }
      historico_selic: {
        Row: {
          data: string
          taxa_anual: number
          provisorio: boolean
        }
        Insert: {
          data: string
          taxa_anual: number
          provisorio?: boolean
        }
        Update: {
          data?: string
          taxa_anual?: number
          provisorio?: boolean
        }
        Relationships: []
      }
      historico_tr: {
        Row: {
          data: string
          taxa_mensal: number
          provisorio: boolean
        }
        Insert: {
          data: string
          taxa_mensal: number
          provisorio?: boolean
        }
        Update: {
          data?: string
          taxa_mensal?: number
          provisorio?: boolean
        }
        Relationships: []
      }
      instituicoes: {
        Row: {
          id: string
          nome: string
          ativa: boolean
          created_at: string
          user_id: string | null
          cnpj: string | null
          segmento: string | null
          origem: string
          nome_busca: string | null
        }
        Insert: {
          id?: string
          nome: string
          ativa?: boolean
          created_at?: string
          user_id?: string | null
          cnpj?: string | null
          segmento?: string | null
          origem?: string
          nome_busca?: string | null
        }
        Update: {
          id?: string
          nome?: string
          ativa?: boolean
          created_at?: string
          user_id?: string | null
          cnpj?: string | null
          segmento?: string | null
          origem?: string
          nome_busca?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instituicoes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      movimentacoes: {
        Row: {
          id: string
          user_id: string
          categoria_id: string
          produto_id: string
          emissor_id: string | null
          instituicao_id: string | null
          poupanca_lote_id: string | null
          codigo_custodia: string | null
          nome_ativo: string | null
          data: string
          tipo_movimentacao: string
          origem: string | null
          valor: number
          quantidade: number | null
          preco_unitario: number | null
          valor_extrato: string | null
          created_at: string
          data_cotizacao: string | null
          fundo_id: string | null
          observacao: string | null
          moeda: string | null
          titulo_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          categoria_id: string
          produto_id: string
          emissor_id?: string | null
          instituicao_id?: string | null
          poupanca_lote_id?: string | null
          codigo_custodia?: string | null
          nome_ativo?: string | null
          data: string
          tipo_movimentacao: string
          origem?: string | null
          valor: number
          quantidade?: number | null
          preco_unitario?: number | null
          valor_extrato?: string | null
          created_at?: string
          data_cotizacao?: string | null
          fundo_id?: string | null
          observacao?: string | null
          moeda?: string | null
          titulo_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          categoria_id?: string
          produto_id?: string
          emissor_id?: string | null
          instituicao_id?: string | null
          poupanca_lote_id?: string | null
          codigo_custodia?: string | null
          nome_ativo?: string | null
          data?: string
          tipo_movimentacao?: string
          origem?: string | null
          valor?: number
          quantidade?: number | null
          preco_unitario?: number | null
          valor_extrato?: string | null
          created_at?: string
          data_cotizacao?: string | null
          fundo_id?: string | null
          observacao?: string | null
          moeda?: string | null
          titulo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movimentacoes_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_emissor_id_fkey"
            columns: ["emissor_id"]
            isOneToOne: false
            referencedRelation: "emissores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_fundo_id_fkey"
            columns: ["fundo_id"]
            isOneToOne: false
            referencedRelation: "cadastro_de_fundos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_instituicao_id_fkey"
            columns: ["instituicao_id"]
            isOneToOne: false
            referencedRelation: "instituicoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_poupanca_lote_id_fkey"
            columns: ["poupanca_lote_id"]
            isOneToOne: false
            referencedRelation: "poupanca_lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: false
            referencedRelation: "cadastro_de_titulos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      poupanca_lotes: {
        Row: {
          id: string
          user_id: string
          custodia_id: string
          codigo_custodia: string | null
          data_aplicacao: string
          dia_aniversario: number | null
          valor_principal: number | null
          valor_atual: number | null
          rendimento_acumulado: number | null
          ultimo_aniversario: string | null
          status: string | null
          data_resgate: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          custodia_id: string
          codigo_custodia?: string | null
          data_aplicacao: string
          dia_aniversario?: number | null
          valor_principal?: number | null
          valor_atual?: number | null
          rendimento_acumulado?: number | null
          ultimo_aniversario?: string | null
          status?: string | null
          data_resgate?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          custodia_id?: string
          codigo_custodia?: string | null
          data_aplicacao?: string
          dia_aniversario?: number | null
          valor_principal?: number | null
          valor_atual?: number | null
          rendimento_acumulado?: number | null
          ultimo_aniversario?: string | null
          status?: string | null
          data_resgate?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "poupanca_lotes_custodia_id_fkey"
            columns: ["custodia_id"]
            isOneToOne: false
            referencedRelation: "custodia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poupanca_lotes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      produtos: {
        Row: {
          id: string
          nome: string
          categoria_id: string
          ativo: boolean
          engine: string | null
          created_at: string
        }
        Insert: {
          id?: string
          nome: string
          categoria_id: string
          ativo?: boolean
          engine?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          nome?: string
          categoria_id?: string
          ativo?: boolean
          engine?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produtos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          }
        ]
      }
      profiles: {
        Row: {
          id: string
          user_id: string
          nome_completo: string | null
          data_nascimento: string | null
          email: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          nome_completo?: string | null
          data_nascimento?: string | null
          email?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          nome_completo?: string | null
          data_nascimento?: string | null
          email?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      user_roles: {
        Row: {
          user_id: string
          role: Database["invest"]["Enums"]["app_role"]
          created_at: string
        }
        Insert: {
          user_id: string
          role: Database["invest"]["Enums"]["app_role"]
          created_at?: string
        }
        Update: {
          user_id?: string
          role?: Database["invest"]["Enums"]["app_role"]
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      user_settings: {
        Row: {
          id: string
          user_id: string
          poupanca_fifo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          poupanca_fifo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          poupanca_fifo?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_email_exists: {
        Args: { p_email: string }
        Returns: boolean
      }
      has_role: {
        Args: { _user_id: string; _role: Database["invest"]["Enums"]["app_role"] }
        Returns: boolean
      }
      horizonte_de_mercado: {
        Args: { p_user: string }
        Returns: string
      }
      is_admin: {
        Args: never
        Returns: boolean
      }
      ultimo_cdi_oficial: {
        Args: never
        Returns: string
      }
    }
    Enums: {
      app_role: 'admin' | 'user'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
  invest: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
