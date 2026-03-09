
-- 1. Add new roles to the enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'management';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'store_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'area_manager';
