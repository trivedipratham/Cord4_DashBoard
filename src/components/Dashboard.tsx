"use client";

import { useState, useMemo, useRef } from "react";
import { IngestionResult, Activity, Employee } from "@/lib/data";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from 'recharts';
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
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

  const exportPDF = async () => {
    if (!dashboardRef.current) return;
    const canvas = await html2canvas(dashboardRef.current, { scale: 1.5 });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
    pdf.save("Executive_Summary.pdf");
  };

  return (
    <div className="min-h-screen relative pb-20">
      <div className="p-8 max-w-7xl mx-auto space-y-8" ref={dashboardRef}>
        
        {/* Header & Controls */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-800">Automation Insights</h1>
            <p className="text-slate-500 text-sm mt-1">Data covers {new Date(data.activities[0]?.date).toLocaleDateString()} to {new Date(data.activities[data.activities.length - 1]?.date).toLocaleDateString()}</p>
          </div>
          
          <div className="flex gap-4 mt-4 md:mt-0">
            <select 
              className="p-2 border border-slate-200 rounded-md shadow-sm bg-slate-50 text-sm font-medium"
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
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium text-sm transition-colors"
            >
              Export PDF
            </button>
          </div>
        </div>

        {/* Anomaly Callout */}
        {anomaly && (
          <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg shadow-sm">
            <h3 className="text-amber-800 font-bold text-sm uppercase">Anomaly Detected</h3>
            <p className="text-amber-700 text-sm mt-1">
              <strong>{anomaly.name} ({anomaly.dept})</strong> has logged {anomaly.nonRepHrs} hours of non-repetitive work, which is highly atypical (&gt;80% manual variance). Consider reviewing their workflow to see if new processes are missing standardized tools.
            </p>
          </div>
        )}

        {/* Headline Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white shadow-sm rounded-xl p-6 border border-slate-200">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide">Hours Recoverable (Monthly)</h2>
            <div className="flex items-end mt-2">
              <p className="text-5xl font-black text-indigo-600">{totalHoursSaved.toFixed(1)}</p>
              <span className="text-slate-400 ml-2 mb-1 font-medium">hrs</span>
            </div>
            <p className="text-xs text-slate-400 mt-3">Methodology: (Repetitive Minutes * 60% automation potential) / 60</p>
          </div>
          
          <div className="bg-white shadow-sm rounded-xl p-6 border border-slate-200">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide">Value Recoverable (Monthly)</h2>
            <div className="flex items-end mt-2">
              <p className="text-5xl font-black text-emerald-600">₹{totalINRSaved.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            </div>
            <p className="text-xs text-slate-400 mt-3">Methodology: Hours saved × Employee's estimated hourly rate</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart: Time Sink by App */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="font-bold text-slate-700 mb-4">Time Sink by Application</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={appBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {appBreakdown.map((entry, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value: any) => `${(value/60).toFixed(1)} hrs`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart: WoW Trend */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="font-bold text-slate-700 mb-4">Repetitive Task Share Trend (WoW)</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={wowTrend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                  <XAxis dataKey="week" axisLine={false} tickLine={false} />
                  <YAxis unit="%" axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value: any) => `${value.toFixed(1)}%`} />
                  <Line type="monotone" dataKey="repetitiveShare" stroke="#00C49F" strokeWidth={3} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Priority Ranking Table */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center">
            <h3 className="font-bold text-slate-700">Automation Priority Ranking</h3>
            <span className="text-xs text-slate-500">Score = (Vol * Rep% * Conc) + Cost/1k</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Task Category</th>
                  <th className="px-6 py-3 font-medium">Volume (Hrs)</th>
                  <th className="px-6 py-3 font-medium">Repetitive %</th>
                  <th className="px-6 py-3 font-medium">Impacted Staff</th>
                  <th className="px-6 py-3 font-medium">Cost Impact (₹)</th>
                  <th className="px-6 py-3 font-medium">Priority Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {automationPriority.slice(0, 8).map((task, idx) => (
                  <tr 
                    key={task.category} 
                    className="hover:bg-indigo-50/50 cursor-pointer transition-colors"
                    onClick={() => setSelectedTaskCategory(task.category === selectedTaskCategory ? null : task.category)}
                  >
                    <td className="px-6 py-4 font-medium text-slate-700 capitalize flex items-center gap-2">
                      {idx < 3 && <span className="w-2 h-2 rounded-full bg-amber-500"></span>}
                      {task.category}
                      {task.category === selectedTaskCategory && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full ml-2">Filtering</span>}
                    </td>
                    <td className="px-6 py-4">{task.volumeHours.toFixed(1)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-slate-200 h-2 rounded-full overflow-hidden">
                          <div className="bg-indigo-500 h-full" style={{ width: `${task.repetitivePercent}%` }}></div>
                        </div>
                        {task.repetitivePercent.toFixed(0)}%
                      </div>
                    </td>
                    <td className="px-6 py-4">{task.employees}</td>
                    <td className="px-6 py-4">₹{task.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-6 py-4 font-bold text-slate-700">{task.score.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Employee Drill-Down */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-700 mb-4">Employee Drill-down (Cross-filtered)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* Show employees who participate in the filtered dataset */}
            {Array.from(new Set(filteredActivities.map(a => a.employeeId))).slice(0, 12).map(empId => {
              const emp = data.employees[empId];
              if (!emp) return null;
              const empActs = filteredActivities.filter(a => a.employeeId === empId);
              const rep = empActs.filter(a => a.isRepetitive).reduce((acc, a) => acc + a.durationMinutes, 0);
              const total = empActs.reduce((acc, a) => acc + a.durationMinutes, 0);
              const pct = total > 0 ? (rep / total) * 100 : 0;
              
              return (
                <div key={empId} className="border border-slate-100 p-4 rounded-lg bg-slate-50 hover:border-indigo-200 transition-colors">
                  <div className="font-bold text-slate-800">{emp.name}</div>
                  <div className="text-xs text-slate-500">{emp.role} • {emp.department}</div>
                  <div className="mt-3 text-sm">
                    <div className="flex justify-between mb-1">
                      <span>Repetitive Task Load</span>
                      <span className="font-medium">{pct.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div className={`h-full ${pct > 70 ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }}></div>
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
