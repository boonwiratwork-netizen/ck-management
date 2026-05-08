-- Create RLS policies for Olive anon read access

-- Allow anon to read branches
CREATE POLICY "Allow Olive anon read branches"
ON public.branches
FOR SELECT
TO anon
USING (true);

-- Allow anon to read menus
CREATE POLICY "Allow Olive anon read menus"
ON public.menus
FOR SELECT
TO anon
USING (true);

-- Allow anon to read skus
CREATE POLICY "Allow Olive anon read skus"
ON public.skus
FOR SELECT
TO anon
USING (true);

-- Allow anon to read prices
CREATE POLICY "Allow Olive anon read prices"
ON public.prices
FOR SELECT
TO anon
USING (true);

-- Allow anon to read suppliers
CREATE POLICY "Allow Olive anon read suppliers"
ON public.suppliers
FOR SELECT
TO anon
USING (true);