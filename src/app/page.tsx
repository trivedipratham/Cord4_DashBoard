import { getCleanData } from "@/lib/data";
import Dashboard from "@/components/Dashboard";

export default function Home() {
  const data = getCleanData();
  
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <Dashboard data={data} />
    </main>
  );
}
