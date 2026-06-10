"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  UploadCloud,
  Package,
  Clock,
  CheckCircle,
  XCircle,
} from "lucide-react";
import type { DashboardStats as Stats } from "@/src/types/product";

interface DashboardStatsProps {
  stats: Stats;
}

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  colorClass: string;
}

function StatCard({ label, value, icon, colorClass }: StatCardProps) {
  return (
    <div
      className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
      role="region"
      aria-label={label}
    >
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${colorClass}`}
        aria-hidden="true"
      >
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
          {value.toLocaleString()}
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
      </div>
    </div>
  );
}

const BAR_COLORS: Record<string, string> = {
  Pending: "#eab308",
  Validated: "#22c55e",
  Error: "#ef4444",
};

export default function DashboardStats({ stats }: DashboardStatsProps) {
  const chartData = [
    { name: "Pending", value: stats.pendingProducts },
    { name: "Validated", value: stats.validatedProducts },
    { name: "Error", value: stats.errorProducts },
  ];

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Total uploads"
          value={stats.totalUploads}
          icon={<UploadCloud className="h-5 w-5 text-blue-600" />}
          colorClass="bg-blue-100 dark:bg-blue-900/40"
        />
        <StatCard
          label="Total products"
          value={stats.totalProducts}
          icon={<Package className="h-5 w-5 text-purple-600" />}
          colorClass="bg-purple-100 dark:bg-purple-900/40"
        />
        <StatCard
          label="Pending"
          value={stats.pendingProducts}
          icon={<Clock className="h-5 w-5 text-yellow-600" />}
          colorClass="bg-yellow-100 dark:bg-yellow-900/40"
        />
        <StatCard
          label="Validated"
          value={stats.validatedProducts}
          icon={<CheckCircle className="h-5 w-5 text-green-600" />}
          colorClass="bg-green-100 dark:bg-green-900/40"
        />
        <StatCard
          label="Errors"
          value={stats.errorProducts}
          icon={<XCircle className="h-5 w-5 text-red-600" />}
          colorClass="bg-red-100 dark:bg-red-900/40"
        />
      </div>

      {/* Product status chart */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Product status breakdown
        </h2>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} aria-label="Product status bar chart">
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                borderRadius: "0.5rem",
                fontSize: "0.75rem",
                border: "none",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              }}
            />
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              {chartData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={BAR_COLORS[entry.name] ?? "#94a3b8"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Recent activity feed */}
      {stats.recentActivity.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Recent activity
          </h2>
          <ol className="space-y-2" aria-label="Recent activity log">
            {stats.recentActivity.slice(0, 8).map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400"
              >
                <span className="truncate">{entry.description}</span>
                <time
                  dateTime={entry.timestamp}
                  className="shrink-0 text-zinc-400 dark:text-zinc-500"
                >
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
