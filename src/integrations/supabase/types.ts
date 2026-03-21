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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      bom_byproducts: {
        Row: {
          bom_header_id: string
          cost_allocation_pct: number
          created_at: string
          id: string
          name: string
          output_qty: number
          sku_id: string | null
          tracks_inventory: boolean
          updated_at: string
        }
        Insert: {
          bom_header_id: string
          cost_allocation_pct?: number
          created_at?: string
          id?: string
          name?: string
          output_qty?: number
          sku_id?: string | null
          tracks_inventory?: boolean
          updated_at?: string
        }
        Update: {
          bom_header_id?: string
          cost_allocation_pct?: number
          created_at?: string
          id?: string
          name?: string
          output_qty?: number
          sku_id?: string | null
          tracks_inventory?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bom_byproducts_bom_header_id_fkey"
            columns: ["bom_header_id"]
            isOneToOne: false
            referencedRelation: "bom_headers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_byproducts_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_headers: {
        Row: {
          batch_size: number
          bom_mode: string
          created_at: string
          id: string
          production_type: string
          sm_sku_id: string
          updated_at: string
          yield_percent: number
        }
        Insert: {
          batch_size?: number
          bom_mode?: string
          created_at?: string
          id?: string
          production_type?: string
          sm_sku_id: string
          updated_at?: string
          yield_percent?: number
        }
        Update: {
          batch_size?: number
          bom_mode?: string
          created_at?: string
          id?: string
          production_type?: string
          sm_sku_id?: string
          updated_at?: string
          yield_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "bom_headers_sm_sku_id_fkey"
            columns: ["sm_sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_lines: {
        Row: {
          bom_header_id: string
          created_at: string
          id: string
          percent_of_input: number | null
          qty_per_batch: number
          qty_type: string | null
          rm_sku_id: string
          step_id: string | null
          yield_percent: number
        }
        Insert: {
          bom_header_id: string
          created_at?: string
          id?: string
          percent_of_input?: number | null
          qty_per_batch?: number
          qty_type?: string | null
          rm_sku_id: string
          step_id?: string | null
          yield_percent?: number
        }
        Update: {
          bom_header_id?: string
          created_at?: string
          id?: string
          percent_of_input?: number | null
          qty_per_batch?: number
          qty_type?: string | null
          rm_sku_id?: string
          step_id?: string | null
          yield_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "bom_lines_bom_header_id_fkey"
            columns: ["bom_header_id"]
            isOneToOne: false
            referencedRelation: "bom_headers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_rm_sku_id_fkey"
            columns: ["rm_sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_steps: {
        Row: {
          bom_header_id: string
          created_at: string
          id: string
          step_name: string
          step_number: number
          yield_percent: number
        }
        Insert: {
          bom_header_id: string
          created_at?: string
          id?: string
          step_name?: string
          step_number?: number
          yield_percent?: number
        }
        Update: {
          bom_header_id?: string
          created_at?: string
          id?: string
          step_name?: string
          step_number?: number
          yield_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "bom_steps_bom_header_id_fkey"
            columns: ["bom_header_id"]
            isOneToOne: false
            referencedRelation: "bom_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_receipts: {
        Row: {
          actual_total: number
          actual_unit_price: number
          branch_id: string
          created_at: string
          id: string
          notes: string
          price_variance: number
          qty_received: number
          receipt_date: string
          sku_id: string
          std_total: number
          std_unit_price: number
          supplier_name: string
          transfer_order_id: string | null
          uom: string
        }
        Insert: {
          actual_total?: number
          actual_unit_price?: number
          branch_id: string
          created_at?: string
          id?: string
          notes?: string
          price_variance?: number
          qty_received?: number
          receipt_date?: string
          sku_id: string
          std_total?: number
          std_unit_price?: number
          supplier_name?: string
          transfer_order_id?: string | null
          uom?: string
        }
        Update: {
          actual_total?: number
          actual_unit_price?: number
          branch_id?: string
          created_at?: string
          id?: string
          notes?: string
          price_variance?: number
          qty_received?: number
          receipt_date?: string
          sku_id?: string
          std_total?: number
          std_unit_price?: number
          supplier_name?: string
          transfer_order_id?: string | null
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_receipts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_receipts_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_receipts_transfer_order_id_fkey"
            columns: ["transfer_order_id"]
            isOneToOne: false
            referencedRelation: "transfer_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          branch_name: string
          brand_name: string
          created_at: string
          id: string
          location: string
          status: string
          updated_at: string
        }
        Insert: {
          branch_name?: string
          brand_name?: string
          created_at?: string
          id?: string
          location?: string
          status?: string
          updated_at?: string
        }
        Update: {
          branch_name?: string
          brand_name?: string
          created_at?: string
          id?: string
          location?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      daily_stock_counts: {
        Row: {
          branch_id: string
          calculated_balance: number
          count_date: string
          created_at: string
          expected_usage: number
          id: string
          is_submitted: boolean
          opening_balance: number
          physical_count: number | null
          received_external: number
          received_from_ck: number
          sku_id: string
          submitted_at: string | null
          variance: number
          waste: number
        }
        Insert: {
          branch_id: string
          calculated_balance?: number
          count_date?: string
          created_at?: string
          expected_usage?: number
          id?: string
          is_submitted?: boolean
          opening_balance?: number
          physical_count?: number | null
          received_external?: number
          received_from_ck?: number
          sku_id: string
          submitted_at?: string | null
          variance?: number
          waste?: number
        }
        Update: {
          branch_id?: string
          calculated_balance?: number
          count_date?: string
          created_at?: string
          expected_usage?: number
          id?: string
          is_submitted?: boolean
          opening_balance?: number
          physical_count?: number | null
          received_external?: number
          received_from_ck?: number
          sku_id?: string
          submitted_at?: string | null
          variance?: number
          waste?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_stock_counts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_stock_counts_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          branch_name: string
          created_at: string
          delivery_date: string
          id: string
          note: string
          qty_delivered_g: number
          sm_sku_id: string
          updated_at: string
          week_number: number
        }
        Insert: {
          branch_name?: string
          created_at?: string
          delivery_date?: string
          id?: string
          note?: string
          qty_delivered_g?: number
          sm_sku_id: string
          updated_at?: string
          week_number?: number
        }
        Update: {
          branch_name?: string
          created_at?: string
          delivery_date?: string
          id?: string
          note?: string
          qty_delivered_g?: number
          sm_sku_id?: string
          updated_at?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_sm_sku_id_fkey"
            columns: ["sm_sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          doc_type: string
          id: string
          last_seq: number
          month: number
          year: number
        }
        Insert: {
          doc_type: string
          id?: string
          last_seq?: number
          month: number
          year: number
        }
        Update: {
          doc_type?: string
          id?: string
          last_seq?: number
          month?: number
          year?: number
        }
        Relationships: []
      }
      global_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value?: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      goods_receipts: {
        Row: {
          actual_total: number
          actual_unit_price: number
          created_at: string
          id: string
          note: string
          price_variance: number
          quantity_received: number
          receipt_date: string
          sku_id: string
          standard_price: number
          std_unit_price: number
          supplier_id: string
          updated_at: string
          usage_uom: string
          week_number: number
        }
        Insert: {
          actual_total?: number
          actual_unit_price?: number
          created_at?: string
          id?: string
          note?: string
          price_variance?: number
          quantity_received?: number
          receipt_date?: string
          sku_id: string
          standard_price?: number
          std_unit_price?: number
          supplier_id: string
          updated_at?: string
          usage_uom?: string
          week_number?: number
        }
        Update: {
          actual_total?: number
          actual_unit_price?: number
          created_at?: string
          id?: string
          note?: string
          price_variance?: number
          quantity_received?: number
          receipt_date?: string
          sku_id?: string
          standard_price?: number
          std_unit_price?: number
          supplier_id?: string
          updated_at?: string
          usage_uom?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_bom: {
        Row: {
          cost_per_serving: number
          created_at: string
          effective_qty: number
          id: string
          menu_id: string
          qty_per_serving: number
          sku_id: string
          uom: string
          yield_pct: number
        }
        Insert: {
          cost_per_serving?: number
          created_at?: string
          effective_qty?: number
          id?: string
          menu_id: string
          qty_per_serving?: number
          sku_id: string
          uom?: string
          yield_pct?: number
        }
        Update: {
          cost_per_serving?: number
          created_at?: string
          effective_qty?: number
          id?: string
          menu_id?: string
          qty_per_serving?: number
          sku_id?: string
          uom?: string
          yield_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_bom_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_bom_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      menu_modifier_rules: {
        Row: {
          created_at: string
          description: string
          id: string
          is_active: boolean
          keyword: string
          menu_id: string | null
          qty_per_match: number
          rule_type: string
          sku_id: string | null
          submenu_id: string | null
          swap_sku_id: string | null
          uom: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          keyword?: string
          menu_id?: string | null
          qty_per_match?: number
          rule_type?: string
          sku_id?: string | null
          submenu_id?: string | null
          swap_sku_id?: string | null
          uom?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          keyword?: string
          menu_id?: string | null
          qty_per_match?: number
          rule_type?: string
          sku_id?: string | null
          submenu_id?: string | null
          swap_sku_id?: string | null
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_modifier_rules_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_modifier_rules_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_modifier_rules_submenu_id_fkey"
            columns: ["submenu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_modifier_rules_swap_sku_id_fkey"
            columns: ["swap_sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      menus: {
        Row: {
          brand_name: string
          category: string
          created_at: string
          id: string
          menu_code: string
          menu_name: string
          selling_price: number
          status: string
          updated_at: string
        }
        Insert: {
          brand_name?: string
          category?: string
          created_at?: string
          id?: string
          menu_code?: string
          menu_name?: string
          selling_price?: number
          status?: string
          updated_at?: string
        }
        Update: {
          brand_name?: string
          category?: string
          created_at?: string
          id?: string
          menu_code?: string
          menu_name?: string
          selling_price?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      modifier_rule_menus: {
        Row: {
          created_at: string
          id: string
          menu_id: string
          rule_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          menu_id: string
          rule_id: string
        }
        Update: {
          created_at?: string
          id?: string
          menu_id?: string
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_rule_menus_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_rule_menus_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "menu_modifier_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_mapping_profiles: {
        Row: {
          created_at: string | null
          date_format: string | null
          has_header_row: boolean | null
          id: string
          mappings: Json
          name: string
          separator: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          date_format?: string | null
          has_header_row?: boolean | null
          id?: string
          mappings: Json
          name: string
          separator?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          date_format?: string | null
          has_header_row?: boolean | null
          id?: string
          mappings?: Json
          name?: string
          separator?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      prices: {
        Row: {
          created_at: string
          effective_date: string
          id: string
          is_active: boolean
          note: string
          price_per_purchase_uom: number
          price_per_usage_uom: number
          sku_id: string
          supplier_id: string
          updated_at: string
          vat: boolean
        }
        Insert: {
          created_at?: string
          effective_date?: string
          id?: string
          is_active?: boolean
          note?: string
          price_per_purchase_uom?: number
          price_per_usage_uom?: number
          sku_id: string
          supplier_id: string
          updated_at?: string
          vat?: boolean
        }
        Update: {
          created_at?: string
          effective_date?: string
          id?: string
          is_active?: boolean
          note?: string
          price_per_purchase_uom?: number
          price_per_usage_uom?: number
          sku_id?: string
          supplier_id?: string
          updated_at?: string
          vat?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "prices_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      production_plans: {
        Row: {
          created_at: string
          id: string
          num_batches: number
          sm_sku_id: string
          status: string
          target_qty_kg: number
          updated_at: string
          week_end_date: string
          week_number: number
          week_start_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          num_batches?: number
          sm_sku_id: string
          status?: string
          target_qty_kg?: number
          updated_at?: string
          week_end_date?: string
          week_number?: number
          week_start_date?: string
        }
        Update: {
          created_at?: string
          id?: string
          num_batches?: number
          sm_sku_id?: string
          status?: string
          target_qty_kg?: number
          updated_at?: string
          week_end_date?: string
          week_number?: number
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_plans_sm_sku_id_fkey"
            columns: ["sm_sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      production_records: {
        Row: {
          actual_output_g: number
          batches_produced: number
          created_at: string
          id: string
          plan_id: string
          production_date: string
          sm_sku_id: string
        }
        Insert: {
          actual_output_g?: number
          batches_produced?: number
          created_at?: string
          id?: string
          plan_id: string
          production_date?: string
          sm_sku_id: string
        }
        Update: {
          actual_output_g?: number
          batches_produced?: number
          created_at?: string
          id?: string
          plan_id?: string
          production_date?: string
          sm_sku_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_records_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "production_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_records_sm_sku_id_fkey"
            columns: ["sm_sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          branch_id: string | null
          created_at: string
          full_name: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          full_name?: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          full_name?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_request_lines: {
        Row: {
          avg_daily_usage: number | null
          created_at: string | null
          id: string
          notes: string | null
          pack_size: number | null
          pr_id: string
          requested_qty: number
          rop: number | null
          sku_id: string
          stock_on_hand: number | null
          suggested_qty: number | null
          supplier_id: string | null
          uom: string
        }
        Insert: {
          avg_daily_usage?: number | null
          created_at?: string | null
          id?: string
          notes?: string | null
          pack_size?: number | null
          pr_id: string
          requested_qty: number
          rop?: number | null
          sku_id: string
          stock_on_hand?: number | null
          suggested_qty?: number | null
          supplier_id?: string | null
          uom: string
        }
        Update: {
          avg_daily_usage?: number | null
          created_at?: string | null
          id?: string
          notes?: string | null
          pack_size?: number | null
          pr_id?: string
          requested_qty?: number
          rop?: number | null
          sku_id?: string
          stock_on_hand?: number | null
          suggested_qty?: number | null
          supplier_id?: string | null
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_request_lines_pr_id_fkey"
            columns: ["pr_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_lines_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_lines_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_requests: {
        Row: {
          branch_id: string
          created_at: string | null
          id: string
          notes: string | null
          pr_number: string
          requested_by: string | null
          requested_date: string
          required_date: string
          status: string
        }
        Insert: {
          branch_id: string
          created_at?: string | null
          id?: string
          notes?: string | null
          pr_number: string
          requested_by?: string | null
          requested_date: string
          required_date: string
          status?: string
        }
        Update: {
          branch_id?: string
          created_at?: string | null
          id?: string
          notes?: string | null
          pr_number?: string
          requested_by?: string | null
          requested_date?: string
          required_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_entries: {
        Row: {
          branch_id: string
          channel: string
          created_at: string
          id: string
          menu_code: string
          menu_name: string
          net_amount: number
          order_type: string
          qty: number
          receipt_no: string
          sale_date: string
          unit_price: number
        }
        Insert: {
          branch_id: string
          channel?: string
          created_at?: string
          id?: string
          menu_code?: string
          menu_name?: string
          net_amount?: number
          order_type?: string
          qty?: number
          receipt_no?: string
          sale_date?: string
          unit_price?: number
        }
        Update: {
          branch_id?: string
          channel?: string
          created_at?: string
          id?: string
          menu_code?: string
          menu_name?: string
          net_amount?: number
          order_type?: string
          qty?: number
          receipt_no?: string
          sale_date?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_entries_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      sku_categories: {
        Row: {
          code: string
          created_at: string
          id: string
          name_en: string
          name_th: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name_en?: string
          name_th?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name_en?: string
          name_th?: string
        }
        Relationships: []
      }
      skus: {
        Row: {
          category: string
          converter: number
          cover_days_target: number | null
          created_at: string
          id: string
          is_distributable: boolean
          lead_time: number
          name: string
          pack_size: number
          pack_unit: string
          purchase_uom: string
          shelf_life: number
          sku_id: string
          spec_note: string
          status: string
          storage_condition: string
          supplier1: string
          supplier2: string
          type: string
          updated_at: string
          usage_uom: string
          vat: boolean
        }
        Insert: {
          category?: string
          converter?: number
          cover_days_target?: number | null
          created_at?: string
          id?: string
          is_distributable?: boolean
          lead_time?: number
          name?: string
          pack_size?: number
          pack_unit?: string
          purchase_uom?: string
          shelf_life?: number
          sku_id?: string
          spec_note?: string
          status?: string
          storage_condition?: string
          supplier1?: string
          supplier2?: string
          type?: string
          updated_at?: string
          usage_uom?: string
          vat?: boolean
        }
        Update: {
          category?: string
          converter?: number
          cover_days_target?: number | null
          created_at?: string
          id?: string
          is_distributable?: boolean
          lead_time?: number
          name?: string
          pack_size?: number
          pack_unit?: string
          purchase_uom?: string
          shelf_life?: number
          sku_id?: string
          spec_note?: string
          status?: string
          storage_condition?: string
          supplier1?: string
          supplier2?: string
          type?: string
          updated_at?: string
          usage_uom?: string
          vat?: boolean
        }
        Relationships: []
      }
      sp_bom: {
        Row: {
          batch_yield_qty: number
          batch_yield_uom: string
          cost_per_unit: number
          created_at: string
          id: string
          ingredient_sku_id: string
          qty_per_batch: number
          sp_sku_id: string
          uom: string
        }
        Insert: {
          batch_yield_qty?: number
          batch_yield_uom?: string
          cost_per_unit?: number
          created_at?: string
          id?: string
          ingredient_sku_id: string
          qty_per_batch?: number
          sp_sku_id: string
          uom?: string
        }
        Update: {
          batch_yield_qty?: number
          batch_yield_uom?: string
          cost_per_unit?: number
          created_at?: string
          id?: string
          ingredient_sku_id?: string
          qty_per_batch?: number
          sp_sku_id?: string
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "sp_bom_ingredient_sku_id_fkey"
            columns: ["ingredient_sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sp_bom_sp_sku_id_fkey"
            columns: ["sp_sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          adjustment_date: string
          created_at: string
          id: string
          quantity: number
          reason: string
          sku_id: string
          stock_type: string
        }
        Insert: {
          adjustment_date?: string
          created_at?: string
          id?: string
          quantity?: number
          reason?: string
          sku_id: string
          stock_type?: string
        }
        Update: {
          adjustment_date?: string
          created_at?: string
          id?: string
          quantity?: number
          reason?: string
          sku_id?: string
          stock_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_lines: {
        Row: {
          created_at: string
          id: string
          note: string
          physical_qty: number | null
          session_id: string
          sku_id: string
          system_qty: number
          type: string
          variance: number
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string
          physical_qty?: number | null
          session_id: string
          sku_id: string
          system_qty?: number
          type?: string
          variance?: number
        }
        Update: {
          created_at?: string
          id?: string
          note?: string
          physical_qty?: number | null
          session_id?: string
          sku_id?: string
          system_qty?: number
          type?: string
          variance?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_lines_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "stock_count_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_sessions: {
        Row: {
          completed_at: string | null
          count_date: string
          created_at: string
          deleted_at: string | null
          id: string
          note: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          count_date?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          note?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          count_date?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          note?: string
          status?: string
        }
        Relationships: []
      }
      stock_opening_balances: {
        Row: {
          id: string
          quantity: number
          sku_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          quantity?: number
          sku_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          quantity?: number
          sku_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_opening_balances_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: true
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact_person: string
          created_at: string
          credit_terms: string
          id: string
          is_central_kitchen: boolean
          lead_time: number
          moq: number
          moq_unit: string
          name: string
          phone: string
          status: string
          updated_at: string
        }
        Insert: {
          contact_person?: string
          created_at?: string
          credit_terms?: string
          id?: string
          is_central_kitchen?: boolean
          lead_time?: number
          moq?: number
          moq_unit?: string
          name?: string
          phone?: string
          status?: string
          updated_at?: string
        }
        Update: {
          contact_person?: string
          created_at?: string
          credit_terms?: string
          id?: string
          is_central_kitchen?: boolean
          lead_time?: number
          moq?: number
          moq_unit?: string
          name?: string
          phone?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      transfer_order_lines: {
        Row: {
          actual_qty: number
          created_at: string
          id: string
          line_value: number
          notes: string
          planned_qty: number
          sku_id: string
          sku_type: string
          to_id: string
          tr_line_id: string | null
          unit_cost: number
          uom: string
        }
        Insert: {
          actual_qty?: number
          created_at?: string
          id?: string
          line_value?: number
          notes?: string
          planned_qty?: number
          sku_id: string
          sku_type?: string
          to_id: string
          tr_line_id?: string | null
          unit_cost?: number
          uom?: string
        }
        Update: {
          actual_qty?: number
          created_at?: string
          id?: string
          line_value?: number
          notes?: string
          planned_qty?: number
          sku_id?: string
          sku_type?: string
          to_id?: string
          tr_line_id?: string | null
          unit_cost?: number
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_order_lines_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_order_lines_to_id_fkey"
            columns: ["to_id"]
            isOneToOne: false
            referencedRelation: "transfer_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_order_lines_tr_line_id_fkey"
            columns: ["tr_line_id"]
            isOneToOne: false
            referencedRelation: "transfer_request_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_orders: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          delivery_date: string
          id: string
          notes: string
          status: string
          to_number: string
          total_value: number
          tr_id: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          delivery_date?: string
          id?: string
          notes?: string
          status?: string
          to_number: string
          total_value?: number
          tr_id?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          delivery_date?: string
          id?: string
          notes?: string
          status?: string
          to_number?: string
          total_value?: number
          tr_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_orders_tr_id_fkey"
            columns: ["tr_id"]
            isOneToOne: false
            referencedRelation: "transfer_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_request_lines: {
        Row: {
          avg_daily_usage: number
          created_at: string
          id: string
          notes: string
          parstock: number
          peak_daily_usage: number
          requested_qty: number
          rop: number
          sku_id: string
          sku_type: string
          stock_on_hand: number
          suggested_qty: number
          tr_id: string
          uom: string
        }
        Insert: {
          avg_daily_usage?: number
          created_at?: string
          id?: string
          notes?: string
          parstock?: number
          peak_daily_usage?: number
          requested_qty?: number
          rop?: number
          sku_id: string
          sku_type?: string
          stock_on_hand?: number
          suggested_qty?: number
          tr_id: string
          uom?: string
        }
        Update: {
          avg_daily_usage?: number
          created_at?: string
          id?: string
          notes?: string
          parstock?: number
          peak_daily_usage?: number
          requested_qty?: number
          rop?: number
          sku_id?: string
          sku_type?: string
          stock_on_hand?: number
          suggested_qty?: number
          tr_id?: string
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_request_lines_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_request_lines_tr_id_fkey"
            columns: ["tr_id"]
            isOneToOne: false
            referencedRelation: "transfer_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_requests: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          notes: string
          requested_by: string | null
          requested_date: string
          required_date: string
          status: string
          tr_number: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          notes?: string
          requested_by?: string | null
          requested_date?: string
          required_date: string
          status?: string
          tr_number: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          notes?: string
          requested_by?: string | null
          requested_date?: string
          required_date?: string
          status?: string
          tr_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_brand_assignments: {
        Row: {
          brand: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          brand: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          brand?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weekly_plan_lines: {
        Row: {
          created_at: string
          id: string
          planned_batches: number
          sku_id: string
          updated_at: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          planned_batches?: number
          sku_id: string
          updated_at?: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          planned_batches?: number
          sku_id?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_plan_lines_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      next_doc_number: {
        Args: { p_month: number; p_type: string; p_year: number }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "ck_manager"
        | "branch_manager"
        | "management"
        | "store_manager"
        | "area_manager"
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
    Enums: {
      app_role: [
        "admin",
        "ck_manager",
        "branch_manager",
        "management",
        "store_manager",
        "area_manager",
      ],
    },
  },
} as const
