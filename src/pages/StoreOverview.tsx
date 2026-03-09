import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Branch } from '@/types/branch';
import { TabKey } from '@/components/AppSidebar';
import {
  ShoppingCart, ClipboardCheck, ClipboardList, TrendingUp, AlertTriangle, CheckCircle2, Store,
} from 'lucide-react';
import { format, subDays } from 'date-fns';

interface StoreOverviewProps {
  branches: Branch[];
  onNavigate: (tab: TabKey) => void;
}

export default function StoreOverview({ branches, onNavigate }: StoreOverviewProps) {
  const { profile, isBranchManager } = useAuth();
  const today = format(new Date(), 'yyyy-MM-dd');
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

  const branchId = isBranchManager ? profile?.branch_id : null;
  const branchName = useMemo(() => {
    if (!branchId) return 'All Branches';
    return branches.find(b => b.id === branchId)?.branchName || 'Your Branch';
  }, [branchId, branches]);

  const [todaySales, setTodaySales] = useState<{ revenue: number; orders: number } | null>(null);
  const [yesterdayStockStatus, setYesterdayStockStatus] = useState<'submitted' | 'not_submitted' | 'loading'>('loading');
  const [salesEnteredToday, setSalesEnteredToday] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      // Today's sales
      let salesQ = supabase.from('sales_entries').select('net_amount, receipt_no').eq('sale_date', today);
      if (branchId) salesQ = salesQ.eq('branch_id', branchId);
      const { data: salesData } = await salesQ;

      if (salesData) {
        const revenue = salesData.reduce((s, r) => s + Number(r.net_amount), 0);
        const uniqueReceipts = new Set(salesData.map(r => r.receipt_no));
        setTodaySales({ revenue, orders: uniqueReceipts.size });
        setSalesEnteredToday(salesData.length > 0);
      } else {
        setTodaySales({ revenue: 0, orders: 0 });
        setSalesEnteredToday(false);
      }

      // Yesterday's stock count status
      let stockQ = supabase.from('daily_stock_counts').select('is_submitted').eq('count_date', yesterday);
      if (branchId) stockQ = stockQ.eq('branch_id', branchId);
      stockQ = stockQ.limit(1);
      const { data: stockData } = await stockQ;

      if (!stockData || stockData.length === 0) {
        setYesterdayStockStatus('not_submitted');
      } else {
        setYesterdayStockStatus(stockData[0].is_submitted ? 'submitted' : 'not_submitted');
      }

      setLoading(false);
    }
    load();
  }, [branchId, today, yesterday]);

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="section-gap">
      {/* Header */}
      <div>
        <h2 className="page-title">Store Overview</h2>
        <p className="page-subtitle">🏪 Store — {branchName}</p>
      </div>

      {/* Alert banners */}
      {!loading && (
        <div className="space-y-3">
          {salesEnteredToday === false && (
            <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4">
              <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Sales not entered today</p>
                <p className="text-helper text-muted-foreground">Paste today's sales data to keep your reports up to date</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => onNavigate('sales-entry')} className="shrink-0">
                Enter Sales
              </Button>
            </div>
          )}
          {yesterdayStockStatus === 'not_submitted' && (
            <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Yesterday's stock count not submitted</p>
                <p className="text-helper text-muted-foreground">Complete and submit yesterday's count to maintain accurate records</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => onNavigate('daily-stock-count')} className="shrink-0">
                Start Count
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="card-hover">
          <CardContent className="p-card-p">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-helper uppercase tracking-wider font-semibold text-muted-foreground">Today's Revenue</p>
                <p className="text-3xl font-bold mt-2 font-mono">
                  {loading ? '—' : `฿${fmt(todaySales?.revenue || 0)}`}
                </p>
              </div>
              <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="card-hover">
          <CardContent className="p-card-p">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-helper uppercase tracking-wider font-semibold text-muted-foreground">Today's Orders</p>
                <p className="text-3xl font-bold mt-2 font-mono">
                  {loading ? '—' : (todaySales?.orders || 0)}
                </p>
              </div>
              <div className="w-10 h-10 rounded-full bg-info/10 flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-info" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Yesterday's stock count status */}
      <Card className="card-hover">
        <CardContent className="p-card-p">
          <div className="flex items-center gap-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              yesterdayStockStatus === 'submitted' ? 'bg-success/10' : 'bg-warning/10'
            }`}>
              <ClipboardCheck className={`w-5 h-5 ${
                yesterdayStockStatus === 'submitted' ? 'text-success' : 'text-warning'
              }`} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Yesterday's Stock Count</p>
              <p className="text-helper text-muted-foreground">{format(subDays(new Date(), 1), 'MMM d, yyyy')}</p>
            </div>
            {yesterdayStockStatus === 'loading' ? (
              <span className="text-helper text-muted-foreground">Loading...</span>
            ) : yesterdayStockStatus === 'submitted' ? (
              <span className="pill-submitted">
                <CheckCircle2 className="w-3.5 h-3.5" /> Submitted
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-warning/10 text-warning">
                <AlertTriangle className="w-3.5 h-3.5" /> Not submitted
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div>
        <h3 className="section-title mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            onClick={() => onNavigate('sales-entry')}
            className="group rounded-lg border bg-card p-card-p text-left card-hover transition-all hover:border-primary/30"
          >
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
              <ShoppingCart className="w-5 h-5 text-primary" />
            </div>
            <p className="font-semibold text-sm">Paste Today's Sales</p>
            <p className="text-helper text-muted-foreground mt-1">Import sales data from your POS</p>
          </button>

          <button
            onClick={() => onNavigate('daily-stock-count')}
            className="group rounded-lg border bg-card p-card-p text-left card-hover transition-all hover:border-primary/30"
          >
            <div className="w-10 h-10 rounded-full bg-info/10 flex items-center justify-center mb-3 group-hover:bg-info/20 transition-colors">
              <ClipboardCheck className="w-5 h-5 text-info" />
            </div>
            <p className="font-semibold text-sm">Start Stock Count</p>
            <p className="text-helper text-muted-foreground mt-1">Count your daily inventory</p>
          </button>

          <button
            onClick={() => onNavigate('branch-receipt')}
            className="group rounded-lg border bg-card p-card-p text-left card-hover transition-all hover:border-primary/30"
          >
            <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center mb-3 group-hover:bg-success/20 transition-colors">
              <ClipboardList className="w-5 h-5 text-success" />
            </div>
            <p className="font-semibold text-sm">Record Receipt</p>
            <p className="text-helper text-muted-foreground mt-1">Log incoming stock deliveries</p>
          </button>
        </div>
      </div>
    </div>
  );
}
