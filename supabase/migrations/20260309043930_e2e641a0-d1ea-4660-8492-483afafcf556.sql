
-- 2. Migrate existing admin users to management role
UPDATE public.user_roles SET role = 'management' WHERE role = 'admin';

-- 3. Migrate existing branch_manager to store_manager
UPDATE public.user_roles SET role = 'store_manager' WHERE role = 'branch_manager';
