with cut as (
  select timestamptz '2026-10-27 07:57:27+07' as at, (public.ck_transfer_rules() ->> 'installed_at')::timestamptz as installed
), tagged as (
  select a.id, a.sku_id, a.quantity, a.reason, a.created_at,
    substring(a.reason from '\[rec ([0-9a-f-]{36})\]') as rec_id,
    substring(a.reason from '^Production(?: correction)?: ([0-9.]+) batches of ') as share
  from public.stock_adjustments a
  where a.branch_id is null and a.reason ~ '^Production(?: correction)?: [0-9.]+ batches of .*\[rec [0-9a-f-]{36}\]' and a.reason !~ ' legacy='
), base as (
  select t.rec_id, t.sku_id, sum(t.quantity) as qty from tagged t, cut where t.created_at < cut.at group by 1, 2
), last_share as (
  select distinct on (t.rec_id) t.rec_id, t.share from tagged t, cut where t.created_at < cut.at order by t.rec_id, t.created_at desc
), ratio as (
  select h.sm_sku_id, l.rm_sku_id as sku_id, sum(l.qty_per_batch / l.yield_percent) / nullif(sum(l.qty_per_batch), 0) as k
  from public.bom_headers h join public.bom_lines l on l.bom_header_id = h.id
  where coalesce(h.bom_mode, 'simple') <> 'multistep' and l.yield_percent > 0
  group by 1, 2
)
select c.id, pr.production_date, sm.name as made, pr.actual_output_g, s.name as ingredient, c.quantity, round((b.qty * (r.k - 1))::numeric, 3) as expected, c.created_at
from tagged c
cross join cut
join public.production_records pr on pr.id::text = c.rec_id and pr.created_at < cut.at
join last_share ls on ls.rec_id = c.rec_id and ls.share = c.share
join base b on b.rec_id = c.rec_id and b.sku_id = c.sku_id
join ratio r on r.sm_sku_id = pr.sm_sku_id and r.sku_id = c.sku_id
join public.skus sm on sm.id = pr.sm_sku_id
join public.skus s on s.id = c.sku_id
where c.reason like 'Production correction: %'
  and c.created_at >= cut.at and c.created_at < cut.installed
  and r.k > 1
  and abs(c.quantity - b.qty * (r.k - 1)) <= 0.01 + 0.001 * abs(b.qty * (r.k - 1))
order by pr.production_date, sm.name;
