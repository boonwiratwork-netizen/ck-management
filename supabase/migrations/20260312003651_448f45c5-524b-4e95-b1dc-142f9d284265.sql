
-- STEP 1a: Add is_central_kitchen to suppliers
ALTER TABLE suppliers ADD COLUMN is_central_kitchen boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX suppliers_one_ck ON suppliers (is_central_kitchen) WHERE is_central_kitchen = true;

-- STEP 2a: Document sequences
CREATE TABLE document_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type text NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL,
  last_seq integer NOT NULL DEFAULT 0,
  UNIQUE (doc_type, year, month)
);

CREATE OR REPLACE FUNCTION next_doc_number(p_type text, p_year integer, p_month integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq integer;
BEGIN
  INSERT INTO document_sequences (doc_type, year, month, last_seq)
  VALUES (p_type, p_year, p_month, 1)
  ON CONFLICT (doc_type, year, month)
  DO UPDATE SET last_seq = document_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN p_type || '-' || p_year || '-' || LPAD(p_month::text, 2, '0') || '-' || LPAD(v_seq::text, 3, '0');
END;
$$;

-- STEP 2b: Transfer Requests
CREATE TABLE transfer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tr_number text NOT NULL UNIQUE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  requested_by uuid REFERENCES profiles(id),
  requested_date date NOT NULL DEFAULT CURRENT_DATE,
  required_date date NOT NULL,
  status text NOT NULL DEFAULT 'Draft',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- STEP 2c: Transfer Request Lines
CREATE TABLE transfer_request_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tr_id uuid NOT NULL REFERENCES transfer_requests(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES skus(id),
  requested_qty numeric NOT NULL DEFAULT 0,
  uom text NOT NULL DEFAULT '',
  suggested_qty numeric NOT NULL DEFAULT 0,
  stock_on_hand numeric NOT NULL DEFAULT 0,
  avg_daily_usage numeric NOT NULL DEFAULT 0,
  peak_daily_usage numeric NOT NULL DEFAULT 0,
  rop numeric NOT NULL DEFAULT 0,
  parstock numeric NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- STEP 2d: Transfer Orders
CREATE TABLE transfer_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_number text NOT NULL UNIQUE,
  tr_id uuid REFERENCES transfer_requests(id) ON DELETE SET NULL,
  branch_id uuid NOT NULL REFERENCES branches(id),
  created_by uuid REFERENCES profiles(id),
  delivery_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'Draft',
  notes text NOT NULL DEFAULT '',
  total_value numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- STEP 2e: Transfer Order Lines
CREATE TABLE transfer_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_id uuid NOT NULL REFERENCES transfer_orders(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES skus(id),
  tr_line_id uuid REFERENCES transfer_request_lines(id) ON DELETE SET NULL,
  planned_qty numeric NOT NULL DEFAULT 0,
  actual_qty numeric NOT NULL DEFAULT 0,
  uom text NOT NULL DEFAULT '',
  unit_cost numeric NOT NULL DEFAULT 0,
  line_value numeric NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- STEP 1b: Add transfer_order_id to branch_receipts (after transfer_orders exists)
ALTER TABLE branch_receipts ADD COLUMN transfer_order_id uuid REFERENCES transfer_orders(id) ON DELETE SET NULL;

-- STEP 3: Validation triggers instead of CHECK constraints
CREATE OR REPLACE FUNCTION validate_transfer_request_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('Draft','Submitted','Acknowledged','Fulfilled','Cancelled') THEN
    RAISE EXCEPTION 'Invalid transfer request status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_tr_status
  BEFORE INSERT OR UPDATE ON transfer_requests
  FOR EACH ROW EXECUTE FUNCTION validate_transfer_request_status();

CREATE OR REPLACE FUNCTION validate_transfer_order_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('Draft','Sent','Received','Partially Received','Cancelled') THEN
    RAISE EXCEPTION 'Invalid transfer order status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_to_status
  BEFORE INSERT OR UPDATE ON transfer_orders
  FOR EACH ROW EXECUTE FUNCTION validate_transfer_order_status();

-- STEP 3: RLS

-- document_sequences
ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view document_sequences" ON document_sequences FOR SELECT TO authenticated USING (true);
CREATE POLICY "CK users can insert document_sequences" ON document_sequences FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role) OR has_role(auth.uid(), 'store_manager'::app_role));
CREATE POLICY "CK users can update document_sequences" ON document_sequences FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role) OR has_role(auth.uid(), 'ck_manager'::app_role) OR has_role(auth.uid(), 'store_manager'::app_role));

-- transfer_requests
ALTER TABLE transfer_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management full select TR" ON transfer_requests FOR SELECT TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management full insert TR" ON transfer_requests FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management full update TR" ON transfer_requests FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management full delete TR" ON transfer_requests FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

CREATE POLICY "CK manager select TR" ON transfer_requests FOR SELECT TO authenticated USING (has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK manager update TR status" ON transfer_requests FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'ck_manager'::app_role));

CREATE POLICY "Store manager select own TR" ON transfer_requests FOR SELECT TO authenticated USING (has_role(auth.uid(), 'store_manager'::app_role) AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid()));
CREATE POLICY "Store manager insert own TR" ON transfer_requests FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'store_manager'::app_role) AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid()));
CREATE POLICY "Store manager update own TR" ON transfer_requests FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'store_manager'::app_role) AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid()));
CREATE POLICY "Store manager delete own TR" ON transfer_requests FOR DELETE TO authenticated USING (has_role(auth.uid(), 'store_manager'::app_role) AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Area manager select TR by brand" ON transfer_requests FOR SELECT TO authenticated USING (has_role(auth.uid(), 'area_manager'::app_role) AND branch_id IN (SELECT b.id FROM branches b JOIN user_brand_assignments uba ON uba.brand = b.brand_name WHERE uba.user_id = auth.uid()));

-- transfer_request_lines
ALTER TABLE transfer_request_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management full select TRL" ON transfer_request_lines FOR SELECT TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management full insert TRL" ON transfer_request_lines FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management full update TRL" ON transfer_request_lines FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management full delete TRL" ON transfer_request_lines FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

CREATE POLICY "CK manager select TRL" ON transfer_request_lines FOR SELECT TO authenticated USING (has_role(auth.uid(), 'ck_manager'::app_role));

CREATE POLICY "Store manager select own TRL" ON transfer_request_lines FOR SELECT TO authenticated USING (has_role(auth.uid(), 'store_manager'::app_role) AND tr_id IN (SELECT id FROM transfer_requests WHERE branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())));
CREATE POLICY "Store manager insert own TRL" ON transfer_request_lines FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'store_manager'::app_role) AND tr_id IN (SELECT id FROM transfer_requests WHERE branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())));
CREATE POLICY "Store manager update own TRL" ON transfer_request_lines FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'store_manager'::app_role) AND tr_id IN (SELECT id FROM transfer_requests WHERE branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())));
CREATE POLICY "Store manager delete own TRL" ON transfer_request_lines FOR DELETE TO authenticated USING (has_role(auth.uid(), 'store_manager'::app_role) AND tr_id IN (SELECT id FROM transfer_requests WHERE branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())));

CREATE POLICY "Area manager select TRL by brand" ON transfer_request_lines FOR SELECT TO authenticated USING (has_role(auth.uid(), 'area_manager'::app_role) AND tr_id IN (SELECT tr.id FROM transfer_requests tr JOIN branches b ON b.id = tr.branch_id JOIN user_brand_assignments uba ON uba.brand = b.brand_name WHERE uba.user_id = auth.uid()));

-- transfer_orders
ALTER TABLE transfer_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management full select TO" ON transfer_orders FOR SELECT TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management full insert TO" ON transfer_orders FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management full update TO" ON transfer_orders FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management full delete TO" ON transfer_orders FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

CREATE POLICY "CK manager full select TO" ON transfer_orders FOR SELECT TO authenticated USING (has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK manager full insert TO" ON transfer_orders FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK manager full update TO" ON transfer_orders FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK manager full delete TO" ON transfer_orders FOR DELETE TO authenticated USING (has_role(auth.uid(), 'ck_manager'::app_role));

CREATE POLICY "Store manager select own TO" ON transfer_orders FOR SELECT TO authenticated USING (has_role(auth.uid(), 'store_manager'::app_role) AND branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Area manager select TO by brand" ON transfer_orders FOR SELECT TO authenticated USING (has_role(auth.uid(), 'area_manager'::app_role) AND branch_id IN (SELECT b.id FROM branches b JOIN user_brand_assignments uba ON uba.brand = b.brand_name WHERE uba.user_id = auth.uid()));

-- transfer_order_lines
ALTER TABLE transfer_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management full select TOL" ON transfer_order_lines FOR SELECT TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management full insert TOL" ON transfer_order_lines FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management full update TOL" ON transfer_order_lines FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));
CREATE POLICY "Management full delete TOL" ON transfer_order_lines FOR DELETE TO authenticated USING (has_role(auth.uid(), 'management'::app_role));

CREATE POLICY "CK manager full select TOL" ON transfer_order_lines FOR SELECT TO authenticated USING (has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK manager full insert TOL" ON transfer_order_lines FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK manager full update TOL" ON transfer_order_lines FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'ck_manager'::app_role));
CREATE POLICY "CK manager full delete TOL" ON transfer_order_lines FOR DELETE TO authenticated USING (has_role(auth.uid(), 'ck_manager'::app_role));

CREATE POLICY "Store manager select own TOL" ON transfer_order_lines FOR SELECT TO authenticated USING (has_role(auth.uid(), 'store_manager'::app_role) AND to_id IN (SELECT id FROM transfer_orders WHERE branch_id = (SELECT profiles.branch_id FROM profiles WHERE profiles.user_id = auth.uid())));

CREATE POLICY "Area manager select TOL by brand" ON transfer_order_lines FOR SELECT TO authenticated USING (has_role(auth.uid(), 'area_manager'::app_role) AND to_id IN (SELECT to2.id FROM transfer_orders to2 JOIN branches b ON b.id = to2.branch_id JOIN user_brand_assignments uba ON uba.brand = b.brand_name WHERE uba.user_id = auth.uid()));

-- STEP 4: Indexes
CREATE INDEX idx_tr_branch ON transfer_requests(branch_id);
CREATE INDEX idx_tr_status ON transfer_requests(status);
CREATE INDEX idx_tr_date ON transfer_requests(requested_date);
CREATE INDEX idx_trl_tr ON transfer_request_lines(tr_id);
CREATE INDEX idx_trl_sku ON transfer_request_lines(sku_id);
CREATE INDEX idx_to_branch ON transfer_orders(branch_id);
CREATE INDEX idx_to_tr ON transfer_orders(tr_id);
CREATE INDEX idx_to_status ON transfer_orders(status);
CREATE INDEX idx_tol_to ON transfer_order_lines(to_id);
CREATE INDEX idx_tol_sku ON transfer_order_lines(sku_id);
CREATE INDEX idx_br_to ON branch_receipts(transfer_order_id);
CREATE INDEX idx_dsc_branch_sku_date ON daily_stock_counts(branch_id, sku_id, count_date DESC);

-- updated_at triggers
CREATE TRIGGER set_updated_at_transfer_requests BEFORE UPDATE ON transfer_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_transfer_orders BEFORE UPDATE ON transfer_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
