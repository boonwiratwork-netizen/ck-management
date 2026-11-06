import type { TabKey } from "@/components/AppSidebar";

/**
 * Each page's code is its own download (Index.tsx makes them with lazy()). This is the one
 * list of those imports: Index lazy-loads from it, and lib/page-prefetch.ts fetches the
 * pages a person uses ahead of time from it — so after a new release the first tap on a
 * page doesn't wait 2–3 s for its code.
 */
export const pageChunks = {
  Dashboard: () => import("@/pages/Dashboard"),
  KitchenReceive: () => import("@/pages/KitchenReceive"),
  KitchenStock: () => import("@/pages/KitchenStock"),
  Produce: () => import("@/pages/Produce"),
  KitchenCount: () => import("@/pages/KitchenCount"),
  Transfer: () => import("@/pages/Transfer"),
  Settings: () => import("@/pages/Settings"),
  MenuSetup: () => import("@/pages/MenuSetup"),
  CostCenter: () => import("@/pages/CostCenter"),
  Sales: () => import("@/pages/Sales"),
  DailyCount: () => import("@/pages/DailyCount"),
  Receive: () => import("@/pages/Receive"),
  Request: () => import("@/pages/Request"),
  FoodCost: () => import("@/pages/FoodCost"),
  StoreOverview: () => import("@/pages/StoreOverview"),
  StoreStock: () => import("@/pages/StoreStock"),
  AdminHome: () => import("@/pages/AdminHome"),
  AlertsInbox: () => import("@/pages/AlertsInbox"),
};

export type PageChunk = keyof typeof pageChunks;

/** Which page's code each address opens (the old pages that land elsewhere point there) */
export const chunkForTab: Record<TabKey, PageChunk> = {
  dashboard: "Dashboard",
  receipt: "KitchenReceive",
  stock: "KitchenStock",
  smstock: "KitchenStock",
  pkstock: "KitchenStock",
  production: "Produce",
  stockcount: "KitchenCount",
  "transfer-order": "Transfer",
  branches: "Settings",
  users: "Settings",
  "sku-categories": "Settings",
  store: "StoreOverview",
  "menu-setup": "CostCenter",
  "cost-center": "CostCenter",
  sku: "CostCenter",
  supplier: "CostCenter",
  price: "CostCenter",
  "menu-master": "CostCenter",
  "menu-bom": "CostCenter",
  "sp-bom": "CostCenter",
  "modifier-rules": "CostCenter",
  "sales-entry": "Sales",
  "branch-receipt": "Receive",
  "branch-receipt-mobile": "Receive",
  "transfer-request": "Request",
  "daily-stock-count": "DailyCount",
  "store-stock": "StoreStock",
  "food-cost": "FoodCost",
  admin: "AdminHome",
  // "เร็วๆ นี้" pages render inside Index (no code of their own yet)
  search: "AdminHome",
  rd: "AdminHome",
  alerts: "AlertsInbox",
};
