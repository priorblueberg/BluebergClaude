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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
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
      categorias: {
        Row: {
          ativa: boolean
          created_at: string
          id: string
          nome: string
        }
        Insert: {
          ativa?: boolean
          created_at?: string
          id?: string
          nome: string
        }
        Update: {
          ativa?: boolean
          created_at?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      controle_de_carteiras: {
        Row: {
          categoria_id: string
          created_at: string
          data_calculo: string | null
          data_inicio: string | null
          data_limite: string | null
          id: string
          nome_carteira: string
          resgate_total: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          categoria_id: string
          created_at?: string
          data_calculo?: string | null
          data_inicio?: string | null
          data_limite?: string | null
          id?: string
          nome_carteira: string
          resgate_total?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          categoria_id?: string
          created_at?: string
          data_calculo?: string | null
          data_inicio?: string | null
          data_limite?: string | null
          id?: string
          nome_carteira?: string
          resgate_total?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "controle_de_carteiras_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      custodia: {
        Row: {
          alocacao_patrimonial: string | null
          amortizacao: number | null
          categoria_id: string
          codigo_custodia: number
          created_at: string
          custodia_no_dia: number | null
          data_calculo: string | null
          data_inicio: string
          data_limite: string | null
          emissor_id: string | null
          estrategia: string | null
          id: string
          indexador: string | null
          instituicao_id: string | null
          modalidade: string | null
          multiplicador: string | null
          nome: string | null
          pagamento: string | null
          preco_unitario: number | null
          produto_id: string
          pu_inicial: number | null
          quantidade: number | null
          rendimentos: number | null
          resgate_total: string | null
          sigla_tesouro: string | null
          status_variavel: string | null
          taxa: number | null
          tipo_movimentacao: string
          user_id: string | null
          valor_investido: number
          vencimento: string | null
        }
        Insert: {
          alocacao_patrimonial?: string | null
          amortizacao?: number | null
          categoria_id: string
          codigo_custodia: number
          created_at?: string
          custodia_no_dia?: number | null
          data_calculo?: string | null
          data_inicio: string
          data_limite?: string | null
          emissor_id?: string | null
          estrategia?: string | null
          id?: string
          indexador?: string | null
          instituicao_id?: string | null
          modalidade?: string | null
          multiplicador?: string | null
          nome?: string | null
          pagamento?: string | null
          preco_unitario?: number | null
          produto_id: string
          pu_inicial?: number | null
          quantidade?: number | null
          rendimentos?: number | null
          resgate_total?: string | null
          sigla_tesouro?: string | null
          status_variavel?: string | null
          taxa?: number | null
          tipo_movimentacao: string
          user_id?: string | null
          valor_investido: number
          vencimento?: string | null
        }
        Update: {
          alocacao_patrimonial?: string | null
          amortizacao?: number | null
          categoria_id?: string
          codigo_custodia?: number
          created_at?: string
          custodia_no_dia?: number | null
          data_calculo?: string | null
          data_inicio?: string
          data_limite?: string | null
          emissor_id?: string | null
          estrategia?: string | null
          id?: string
          indexador?: string | null
          instituicao_id?: string | null
          modalidade?: string | null
          multiplicador?: string | null
          nome?: string | null
          pagamento?: string | null
          preco_unitario?: number | null
          produto_id?: string
          pu_inicial?: number | null
          quantidade?: number | null
          rendimentos?: number | null
          resgate_total?: string | null
          sigla_tesouro?: string | null
          status_variavel?: string | null
          taxa?: number | null
          tipo_movimentacao?: string
          user_id?: string | null
          valor_investido?: number
          vencimento?: string | null
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
        ]
      }
      dias_semana: {
        Row: {
          id: number
          nome_completo: string
          sigla: string
        }
        Insert: {
          id: number
          nome_completo: string
          sigla: string
        }
        Update: {
          id?: number
          nome_completo?: string
          sigla?: string
        }
        Relationships: []
      }
      emissores: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          nome: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      historico_cdi: {
        Row: {
          data: string
          taxa_anual: number
        }
        Insert: {
          data: string
          taxa_anual: number
        }
        Update: {
          data?: string
          taxa_anual?: number
        }
        Relationships: []
      }
      historico_ibovespa: {
        Row: {
          data: string
          pontos: number
        }
        Insert: {
          data: string
          pontos: number
        }
        Update: {
          data?: string
          pontos?: number
        }
        Relationships: []
      }
      historico_poupanca_rendimento: {
        Row: {
          data: string
          rendimento_mensal: number
        }
        Insert: {
          data: string
          rendimento_mensal: number
        }
        Update: {
          data?: string
          rendimento_mensal?: number
        }
        Relationships: []
      }
      historico_selic: {
        Row: {
          data: string
          taxa_anual: number
        }
        Insert: {
          data: string
          taxa_anual: number
        }
        Update: {
          data?: string
          taxa_anual?: number
        }
        Relationships: []
      }
      historico_tr: {
        Row: {
          data: string
          taxa_mensal: number
        }
        Insert: {
          data: string
          taxa_mensal: number
        }
        Update: {
          data?: string
          taxa_mensal?: number
        }
        Relationships: []
      }
      instituicoes: {
        Row: {
          ativa: boolean
          created_at: string
          id: string
          nome: string
        }
        Insert: {
          ativa?: boolean
          created_at?: string
          id?: string
          nome: string
        }
        Update: {
          ativa?: boolean
          created_at?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      movimentacoes: {
        Row: {
          categoria_id: string
          codigo_custodia: number | null
          created_at: string
          data: string
          emissor_id: string | null
          id: string
          indexador: string | null
          instituicao_id: string | null
          modalidade: string | null
          nome_ativo: string | null
          origem: string
          pagamento: string | null
          poupanca_lote_id: string | null
          preco_unitario: number | null
          produto_id: string
          quantidade: number | null
          taxa: number | null
          tipo_movimentacao: string
          user_id: string | null
          valor: number
          valor_extrato: string | null
          vencimento: string | null
        }
        Insert: {
          categoria_id: string
          codigo_custodia?: number | null
          created_at?: string
          data?: string
          emissor_id?: string | null
          id?: string
          indexador?: string | null
          instituicao_id?: string | null
          modalidade?: string | null
          nome_ativo?: string | null
          origem?: string
          pagamento?: string | null
          poupanca_lote_id?: string | null
          preco_unitario?: number | null
          produto_id: string
          quantidade?: number | null
          taxa?: number | null
          tipo_movimentacao: string
          user_id?: string | null
          valor: number
          valor_extrato?: string | null
          vencimento?: string | null
        }
        Update: {
          categoria_id?: string
          codigo_custodia?: number | null
          created_at?: string
          data?: string
          emissor_id?: string | null
          id?: string
          indexador?: string | null
          instituicao_id?: string | null
          modalidade?: string | null
          nome_ativo?: string | null
          origem?: string
          pagamento?: string | null
          poupanca_lote_id?: string | null
          preco_unitario?: number | null
          produto_id?: string
          quantidade?: number | null
          taxa?: number | null
          tipo_movimentacao?: string
          user_id?: string | null
          valor?: number
          valor_extrato?: string | null
          vencimento?: string | null
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
        ]
      }
      poupanca_lotes: {
        Row: {
          codigo_custodia: number
          created_at: string
          custodia_id: string | null
          data_aplicacao: string
          data_resgate: string | null
          dia_aniversario: number
          id: string
          rendimento_acumulado: number
          status: string
          ultimo_aniversario: string | null
          user_id: string
          valor_atual: number
          valor_principal: number
        }
        Insert: {
          codigo_custodia: number
          created_at?: string
          custodia_id?: string | null
          data_aplicacao: string
          data_resgate?: string | null
          dia_aniversario: number
          id?: string
          rendimento_acumulado?: number
          status?: string
          ultimo_aniversario?: string | null
          user_id: string
          valor_atual: number
          valor_principal: number
        }
        Update: {
          codigo_custodia?: number
          created_at?: string
          custodia_id?: string | null
          data_aplicacao?: string
          data_resgate?: string | null
          dia_aniversario?: number
          id?: string
          rendimento_acumulado?: number
          status?: string
          ultimo_aniversario?: string | null
          user_id?: string
          valor_atual?: number
          valor_principal?: number
        }
        Relationships: [
          {
            foreignKeyName: "poupanca_lotes_custodia_id_fkey"
            columns: ["custodia_id"]
            isOneToOne: false
            referencedRelation: "custodia"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          ativo: boolean
          categoria_id: string
          created_at: string
          id: string
          nome: string
        }
        Insert: {
          ativo?: boolean
          categoria_id: string
          created_at?: string
          id?: string
          nome: string
        }
        Update: {
          ativo?: boolean
          categoria_id?: string
          created_at?: string
          id?: string
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "produtos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          data_nascimento: string | null
          email: string | null
          id: string
          nome_completo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data_nascimento?: string | null
          email?: string | null
          id?: string
          nome_completo: string
          user_id: string
        }
        Update: {
          created_at?: string
          data_nascimento?: string | null
          email?: string | null
          id?: string
          nome_completo?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          id: string
          poupanca_fifo: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          poupanca_fifo?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          poupanca_fifo?: boolean
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_email_exists: { Args: { p_email: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
} as const
