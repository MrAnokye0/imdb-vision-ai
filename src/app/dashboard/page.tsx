import DashboardStats from "@/src/components/DashboardStats";
import type { DashboardStats as Stats } from "@/src/types/product";

/**
 * In a real application this data would be fetched from Firestore.
 * The function is async-ready so you can swap in a real data source.
 */
async function getStats(): Promise<Stats> {
  // Placeholder data — replace with Firestore queries when ready.
  return {
    totalUploads: 0,
    totalProducts: 0,
    pendingProducts: 0,
    validatedProducts: 0,
    errorProducts: 0,
    recentActivity: [],
  };
}

export default async function DashboardPage() {
  const stats = await getStats();

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <header>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Overview of all product extractions.
        </p>
      </header>

      <DashboardStats stats={stats} />
    </main>
  );
}
