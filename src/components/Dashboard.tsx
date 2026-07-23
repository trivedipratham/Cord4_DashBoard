"use client";

import { useState, useMemo, useRef } from "react";
import type { IngestionResult, Activity as ActivityData, Employee } from "@/lib/data";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from 'recharts';
import { AlertTriangle, Download, TrendingUp, Clock, Users, Activity as ActivityIcon, Zap, IndianRupee, Layers } from 'lucide-react';
import ChatWidget from "./ChatWidget";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

export default function Dashboard({ data }: { data: IngestionResult }) {
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [selectedTaskCategory, setSelectedTaskCategory] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);

  // Filtered activities based on global cross-filters
  const filteredActivities = useMemo(() => {
    let acts = data.activities;
    if (selectedDept) acts = acts.filter(a => a.department === selectedDept);
    // Note: The prompt asks for task category to filter employee list, not necessarily the whole dashboard, but we apply it.
    if (selectedTaskCategory) acts = acts.filter(a => a.taskCategory === selectedTaskCategory);
    return acts;
  }, [data, selectedDept, selectedTaskCategory]);

  // Headline Numbers
  const { totalHoursSaved, totalINRSaved } = useMemo(() => {
    let hours = 0;
    let inr = 0;
    filteredActivities.forEach(act => {
      if (act.isRepetitive) {
        const saved = (act.durationMinutes * 0.6) / 60; // assumption: 60% automation potential
        hours += saved;
        const emp = data.employees[act.employeeId];
        if (emp && emp.salaryMonthlyINR > 0) {
          const hourlyRate = emp.salaryMonthlyINR / 160;
          inr += saved * hourlyRate;
        }
      }
    });
    return { totalHoursSaved: hours, totalINRSaved: inr };
  }, [filteredActivities, data.employees]);

  // Time sink breakdown by App
  const appBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    filteredActivities.forEach(a => {
      map[a.appUsed] = (map[a.appUsed] || 0) + a.durationMinutes;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [filteredActivities]);

  // Automation Priority Ranking
  const automationPriority = useMemo(() => {
    const taskMap: Record<string, { minutes: number, repetitiveMinutes: number, cost: number, employees: Set<string> }> = {};
    
    // We calculate over the ALL or filtered data? Let's use filtered.
    filteredActivities.forEach(act => {
      if (!taskMap[act.taskCategory]) {
        taskMap[act.taskCategory] = { minutes: 0, repetitiveMinutes: 0, cost: 0, employees: new Set() };
      }
      taskMap[act.taskCategory].minutes += act.durationMinutes;
      if (act.isRepetitive) taskMap[act.taskCategory].repetitiveMinutes += act.durationMinutes;
      taskMap[act.taskCategory].employees.add(act.employeeId);
      
      const emp = data.employees[act.employeeId];
      if (emp && emp.salaryMonthlyINR > 0) {
        const hourlyRate = emp.salaryMonthlyINR / 160;
        taskMap[act.taskCategory].cost += (act.durationMinutes / 60) * hourlyRate;
      }
    });

    return Object.entries(taskMap).map(([category, stats]) => {
      const volHours = stats.minutes / 60;
      const repPercent = stats.minutes > 0 ? stats.repetitiveMinutes / stats.minutes : 0;
      const conc = stats.employees.size;
      // Formula: Score = (Volume Hours * Repetitive % * Concentration) + (Cost / 1000)
      const score = (volHours * repPercent * conc) + (stats.cost / 1000);
      
      return {
        category,
        volumeHours: volHours,
        repetitivePercent: repPercent * 100,
        employees: conc,
        cost: stats.cost,
        score
      };
    }).sort((a, b) => b.score - a.score);
  }, [filteredActivities, data.employees]);

  // Week-over-week trend for repetitive task share
  const wowTrend = useMemo(() => {
    // Group by week (using simple ISO week approximation based on date string)
    const weeks: Record<string, { total: number, repetitive: number }> = {};
    filteredActivities.forEach(act => {
      // Very simple grouping by just sorting into 7-day buckets starting from earliest date
      const date = act.date; 
      if (!weeks[date]) weeks[date] = { total: 0, repetitive: 0 };
      weeks[date].total += act.durationMinutes;
      if (act.isRepetitive) weeks[date].repetitive += act.durationMinutes;
    });

    // aggregate to weeks
    const sortedDates = Object.keys(weeks).sort();
    if (sortedDates.length === 0) return [];
    
    const startDate = new Date(sortedDates[0]);
    const weeklyBuckets: Record<string, { total: number, repetitive: number }> = {};
    
    sortedDates.forEach(dateStr => {
      const d = new Date(dateStr);
      const diffTime = Math.abs(d.getTime() - startDate.getTime());
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      const weekNum = Math.floor(diffDays / 7) + 1;
      const wKey = `Week ${weekNum}`;
      
      if (!weeklyBuckets[wKey]) weeklyBuckets[wKey] = { total: 0, repetitive: 0 };
      weeklyBuckets[wKey].total += weeks[dateStr].total;
      weeklyBuckets[wKey].repetitive += weeks[dateStr].repetitive;
    });

    return Object.entries(weeklyBuckets).map(([week, stats]) => ({
      week,
      repetitiveShare: stats.total > 0 ? (stats.repetitive / stats.total) * 100 : 0
    }));
  }, [filteredActivities]);

  // Anomaly Detection
  const anomaly = useMemo(() => {
    // Let's find an employee who has > 80% non-repetitive tasks but high volume
    const empStats: Record<string, { total: number, repetitive: number }> = {};
    data.activities.forEach(a => {
      if (!empStats[a.employeeId]) empStats[a.employeeId] = { total: 0, repetitive: 0 };
      empStats[a.employeeId].total += a.durationMinutes;
      if (a.isRepetitive) empStats[a.employeeId].repetitive += a.durationMinutes;
    });

    let outlier: any = null;
    let maxNonRepetitiveHrs = 0;
    
    Object.entries(empStats).forEach(([id, stats]) => {
      const nonRep = stats.total - stats.repetitive;
      if (stats.total > 600 && (nonRep / stats.total) > 0.8) { // >10 hours and >80% non-repetitive
        if (nonRep > maxNonRepetitiveHrs) {
          maxNonRepetitiveHrs = nonRep;
          outlier = {
            id,
            name: data.employees[id]?.name,
            dept: data.employees[id]?.department,
            nonRepHrs: (nonRep / 60).toFixed(1)
          };
        }
      }
    });
    
    return outlier;
  }, [data.activities, data.employees]);

  const exportPDF = () => {
    window.print();
  };

  return (
    <div className="min-h-screen relative pb-20 bg-[#f8fafc] font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Top Banner Gradient */}
      <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 pointer-events-none -z-10" />
      
      <div className="p-4 md:p-8 max-w-[90rem] mx-auto space-y-8" ref={dashboardRef}>
        
        {/* Header & Controls */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white/70 backdrop-blur-xl p-6 rounded-2xl shadow-sm border border-white/50">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
                <ActivityIcon className="text-white" size={20} />
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Automation Insights</h1>
            </div>
            <p className="text-slate-500 text-sm mt-2 ml-[52px] font-medium">Data covers {new Date(data.activities[0]?.date).toLocaleDateString()} to {new Date(data.activities[data.activities.length - 1]?.date).toLocaleDateString()}</p>
          </div>
          
          <div className="flex gap-4 mt-6 md:mt-0 w-full md:w-auto">
            <select 
              className="px-4 py-2.5 border-0 rounded-xl shadow-sm bg-white text-slate-700 text-sm font-semibold ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 transition-all outline-none print:hidden cursor-pointer flex-1 md:flex-none"
              value={selectedDept || ""}
              onChange={(e) => setSelectedDept(e.target.value || null)}
            >
              <option value="">All Departments</option>
              {Array.from(new Set(data.activities.map(a => a.department))).filter(Boolean).map(dept => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
            <button 
              onClick={exportPDF}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl font-semibold text-sm shadow-md shadow-slate-900/20 transition-all active:scale-95 print:hidden"
            >
              <Download size={16} />
              Export PDF
            </button>
          </div>
        </div>

        {/* Anomaly Callout */}
        {anomaly && (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 p-5 rounded-2xl shadow-sm flex items-start gap-4">
            <div className="bg-amber-100 p-2 rounded-full mt-1">
              <AlertTriangle className="text-amber-600" size={20} />
            </div>
            <div>
              <h3 className="text-amber-900 font-bold text-sm tracking-wide uppercase flex items-center gap-2">
                Anomaly Detected
                <span className="bg-amber-200 text-amber-800 text-[10px] px-2 py-0.5 rounded-full font-bold">Review Required</span>
              </h3>
              <p className="text-amber-800/80 text-sm mt-1.5 leading-relaxed">
                <strong className="text-amber-900">{anomaly.name} ({anomaly.dept})</strong> has logged <strong className="text-amber-900">{anomaly.nonRepHrs} hours</strong> of non-repetitive work, which is highly atypical (&gt;80% manual variance). Consider reviewing their workflow to see if new processes are missing standardized tools.
              </p>
            </div>
          </div>
        )}

        {/* Headline Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-xl shadow-indigo-900/10 rounded-3xl p-8 border border-indigo-400/30 text-white relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 group-hover:rotate-12 transition-transform duration-500">
              <Clock size={120} />
            </div>
            <div className="relative z-10">
              <h2 className="text-indigo-100 font-semibold uppercase tracking-wider text-sm flex items-center gap-2">
                <Clock size={16} /> Hours Recoverable (Monthly)
              </h2>
              <div className="flex items-end mt-4">
                <p className="text-6xl font-black tracking-tight">{totalHoursSaved.toFixed(1)}</p>
                <span className="text-indigo-200 ml-2 mb-2 font-bold text-lg">hrs</span>
              </div>
              <p className="text-xs text-indigo-200 mt-6 bg-indigo-900/30 inline-block px-3 py-1.5 rounded-lg border border-indigo-400/20 backdrop-blur-sm">
                Methodology: (Repetitive Minutes * 60% automation potential) / 60
              </p>
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-emerald-500 to-teal-700 shadow-xl shadow-emerald-900/10 rounded-3xl p-8 border border-emerald-400/30 text-white relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 group-hover:rotate-12 transition-transform duration-500">
              <IndianRupee size={120} />
            </div>
            <div className="relative z-10">
              <h2 className="text-emerald-100 font-semibold uppercase tracking-wider text-sm flex items-center gap-2">
                <Zap size={16} /> Value Recoverable (Monthly)
              </h2>
              <div className="flex items-end mt-4">
                <p className="text-6xl font-black tracking-tight">₹{totalINRSaved.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              </div>
              <p className="text-xs text-emerald-200 mt-6 bg-emerald-900/30 inline-block px-3 py-1.5 rounded-lg border border-emerald-400/20 backdrop-blur-sm">
                Methodology: Hours saved × Employee's estimated hourly rate
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart: Time Sink by App */}
          <div className="bg-white p-7 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-6">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Layers size={18} /></div>
              <h3 className="font-bold text-slate-800 text-lg">Time Sink by Application</h3>
            </div>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={appBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} label>
                    {appBreakdown.map((entry, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} stroke="transparent" />)}
                  </Pie>
                  <Tooltip formatter={(value: any) => `${(value/60).toFixed(1)} hrs`} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px -4px rgba(0,0,0,0.1)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart: WoW Trend */}
          <div className="bg-white p-7 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-6">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><TrendingUp size={18} /></div>
              <h3 className="font-bold text-slate-800 text-lg">Repetitive Task Share (WoW)</h3>
            </div>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={wowTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="week" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} dy={10} />
                  <YAxis unit="%" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                  <Tooltip formatter={(value: any) => `${value.toFixed(1)}%`} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px -4px rgba(0,0,0,0.1)' }} />
                  <Line type="monotone" dataKey="repetitiveShare" stroke="#0ea5e9" strokeWidth={4} dot={{r: 4, strokeWidth: 2}} activeDot={{r: 6}} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Priority Ranking Table */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-7 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><ActivityIcon size={18} /></div>
              <h3 className="font-bold text-slate-800 text-lg">Automation Priority Ranking</h3>
            </div>
            <span className="text-[11px] font-bold tracking-wider text-slate-400 uppercase bg-slate-100 px-3 py-1.5 rounded-full">Score = (Vol * Rep% * Conc) + Cost/1k</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-white text-slate-400 border-b border-slate-100 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-7 py-4 font-bold">Task Category</th>
                  <th className="px-7 py-4 font-bold">Volume (Hrs)</th>
                  <th className="px-7 py-4 font-bold">Repetitive %</th>
                  <th className="px-7 py-4 font-bold text-center">Impacted Staff</th>
                  <th className="px-7 py-4 font-bold">Cost Impact (₹)</th>
                  <th className="px-7 py-4 font-bold text-right">Priority Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {automationPriority.slice(0, 8).map((task, idx) => (
                  <tr 
                    key={task.category} 
                    className="hover:bg-slate-50 cursor-pointer transition-colors group"
                    onClick={() => setSelectedTaskCategory(task.category === selectedTaskCategory ? null : task.category)}
                  >
                    <td className="px-7 py-5 font-semibold text-slate-700 capitalize flex items-center gap-3">
                      {idx < 3 ? (
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${idx === 0 ? 'bg-amber-500 shadow-md shadow-amber-500/20' : idx === 1 ? 'bg-slate-400' : 'bg-amber-700'}`}>
                          {idx + 1}
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-[10px] font-bold">{idx + 1}</div>
                      )}
                      {task.category}
                      {task.category === selectedTaskCategory && <span className="text-[10px] uppercase tracking-wider bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md ml-2 font-bold">Filtering</span>}
                    </td>
                    <td className="px-7 py-5 text-slate-600 font-medium">{task.volumeHours.toFixed(1)}</td>
                    <td className="px-7 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-20 bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${task.repetitivePercent > 70 ? 'bg-rose-500' : 'bg-indigo-500'}`} style={{ width: `${task.repetitivePercent}%` }}></div>
                        </div>
                        <span className="font-semibold text-slate-600">{task.repetitivePercent.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-7 py-5 text-center">
                      <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold text-xs group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                        {task.employees}
                      </div>
                    </td>
                    <td className="px-7 py-5 text-slate-600 font-medium">₹{task.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-7 py-5 font-black text-indigo-600 text-right text-base">{task.score.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Employee Drill-Down */}
        <div className="bg-white p-7 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 bg-violet-50 text-violet-600 rounded-lg"><Users size={18} /></div>
            <h3 className="font-bold text-slate-800 text-lg">Employee Drill-down <span className="text-slate-400 font-medium text-sm ml-2">({Array.from(new Set(filteredActivities.map(a => a.employeeId))).length} matching profiles)</span></h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {/* Show employees who participate in the filtered dataset */}
            {Array.from(new Set(filteredActivities.map(a => a.employeeId))).slice(0, 12).map(empId => {
              const emp = data.employees[empId];
              if (!emp) return null;
              const empActs = filteredActivities.filter(a => a.employeeId === empId);
              const rep = empActs.filter(a => a.isRepetitive).reduce((acc, a) => acc + a.durationMinutes, 0);
              const total = empActs.reduce((acc, a) => acc + a.durationMinutes, 0);
              const pct = total > 0 ? (rep / total) * 100 : 0;
              
              return (
                <div key={empId} className="group relative border border-slate-100 p-5 rounded-2xl bg-white hover:bg-slate-50 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] hover:shadow-lg hover:shadow-indigo-500/10 hover:border-indigo-200 transition-all duration-300 transform hover:-translate-y-1">
                  <div className="flex justify-between items-start mb-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-100 to-indigo-50 flex items-center justify-center text-indigo-700 font-bold border border-indigo-100 group-hover:scale-110 transition-transform">
                      {emp.name.split(' ').map((n:string) => n[0]).join('').substring(0,2)}
                    </div>
                    {pct > 70 && <span className="bg-rose-100 text-rose-700 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md">High Risk</span>}
                  </div>
                  <div className="font-bold text-slate-800 text-base">{emp.name}</div>
                  <div className="text-[13px] text-slate-500 font-medium mt-0.5">{emp.role}</div>
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider font-bold mt-1 bg-slate-100 inline-block px-2 py-0.5 rounded-sm">{emp.department}</div>
                  
                  <div className="mt-5 bg-slate-50 p-3 rounded-xl border border-slate-100 group-hover:bg-white transition-colors">
                    <div className="flex justify-between mb-1.5 items-end">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Repetitive Load</span>
                      <span className={`font-black text-sm ${pct > 70 ? 'text-rose-600' : 'text-slate-700'}`}>{pct.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div className={`h-full transition-all duration-1000 ease-out ${pct > 70 ? 'bg-rose-500' : pct > 40 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }}></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      
      {/* AI Assistant Chat Widget */}
      <ChatWidget dataSummary={data.stats} topTasks={automationPriority.slice(0,3)} headline={{hours: totalHoursSaved, inr: totalINRSaved}} />
    </div>
  )
}
