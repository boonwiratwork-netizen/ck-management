
-- Step 1: Add brand_name column
ALTER TABLE public.menus ADD COLUMN brand_name text NOT NULL DEFAULT '';

-- Step 2: Populate brand_name from branches via branch_id
UPDATE public.menus SET brand_name = b.brand_name FROM public.branches b WHERE menus.branch_id = b.id;

-- Step 3: Drop FK constraint
ALTER TABLE public.menus DROP CONSTRAINT menus_branch_id_fkey;

-- Step 4: Drop branch_id column
ALTER TABLE public.menus DROP COLUMN branch_id;
