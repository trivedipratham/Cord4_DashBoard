import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

export interface Employee {
  id: string;
  name: string;
  department: string;
  role: string;
  salaryMonthlyINR: number;
  status: string;
  terminatedOn?: string;
}

export interface Activity {
  employeeId: string;
  department: string;
  timestamp: string;
  date: string;
  appUsed: string;
  taskCategory: string;
  durationMinutes: number;
  isRepetitive: boolean;
}

export interface IngestionResult {
  employees: Record<string, Employee>;
  activities: Activity[];
  stats: {
    employeesTotal: number;
    employeesDropped: number;
    activitiesTotal: number;
    activitiesDropped: number;
    activitiesFixed: number;
  };
}

let cachedData: IngestionResult | null = null;

export function getCleanData(): IngestionResult {
  if (cachedData) return cachedData;

  const dataDir = path.join(process.cwd(), 'src', 'data');
  
  // Read and parse JSON
  let employeesRaw: any = {};
  try {
    const rawJson = fs.readFileSync(path.join(dataDir, 'employees.json'), 'utf8');
    employeesRaw = JSON.parse(rawJson);
  } catch (err) {
    console.error("Failed to read employees.json", err);
  }

  // Read CSV
  let activityLogsRaw = '';
  try {
    activityLogsRaw = fs.readFileSync(path.join(dataDir, 'activity_logs.csv'), 'utf8');
  } catch (err) {
    console.error("Failed to read activity_logs.csv", err);
  }

  let employeesDropped = 0;
  let activitiesDropped = 0;
  let activitiesFixed = 0;

  // Clean Employees
  const employeesMap: Record<string, Employee> = {};
  const seenIds = new Set<string>();

  const rawEmployeesList = employeesRaw.employees || [];
  for (const emp of rawEmployeesList) {
    const id = (emp.EmployeeID || emp.employee_id)?.trim();
    if (!id) {
      employeesDropped++;
      continue;
    }

    // handle duplicate ids (take the active one or first one)
    if (seenIds.has(id)) {
      employeesDropped++;
      continue; 
    }
    seenIds.add(id);

    const name = (emp.Name || emp.name)?.trim() || 'Unknown';
    const department = (emp.Dept || emp.department)?.trim() || 'Unknown';
    const role = (emp.Role || emp.role || emp.meta?.role)?.trim() || 'Unknown';
    const status = (emp.Status || emp.status)?.toLowerCase() || 'active';
    const terminatedOn = emp.terminated_on;

    let salaryMonthlyINR = 0;
    if (emp.salary_LPA) {
      salaryMonthlyINR = (emp.salary_LPA * 100000) / 12;
    } else if (emp.annual_ctc_inr) {
      salaryMonthlyINR = emp.annual_ctc_inr / 12;
    } else if (emp.hourly_rate_inr) {
      salaryMonthlyINR = emp.hourly_rate_inr * 160; // assume 160 hours per month
    } else if (emp.meta?.compensation?.annual) {
      let annual = emp.meta.compensation.annual;
      if (emp.meta.compensation.currency === 'INR') {
        salaryMonthlyINR = annual / 12;
      }
    }

    employeesMap[id] = {
      id,
      name,
      department,
      role,
      salaryMonthlyINR,
      status,
      terminatedOn,
    };
  }

  // Clean Activity Logs
  const activities: Activity[] = [];
  const parsedCsv = Papa.parse(activityLogsRaw, { header: true, skipEmptyLines: true });
  
  for (const row of parsedCsv.data as any[]) {
    let empId = row.employee_id?.trim();
    if (!empId || empId === '?') {
      activitiesDropped++;
      continue;
    }

    // If employee is missing in HRMS, create a dummy employee
    if (!employeesMap[empId]) {
      employeesMap[empId] = {
        id: empId,
        name: \`Unknown Employee (\${empId})\`,
        department: row.department?.trim() || 'Unknown',
        role: 'Unknown',
        salaryMonthlyINR: 0,
        status: 'unknown',
      };
      seenIds.add(empId);
      activitiesFixed++; // consider this a fix
    }

    let rawApp = row.app_used?.trim();
    if (!rawApp || rawApp === 'NA' || rawApp === '-') {
      activitiesDropped++;
      continue;
    }
    const appUsed = rawApp.toLowerCase().replace(/\s+/g, ' '); 
    if (rawApp !== appUsed) activitiesFixed++;

    let rawCat = row.task_category?.trim();
    if (!rawCat || rawCat === 'NA') rawCat = 'Other';
    const taskCategory = rawCat.toLowerCase().replace(/\s+/g, ' ');
    if (rawCat !== taskCategory) activitiesFixed++;

    let duration = parseFloat(row.duration_minutes);
    if (isNaN(duration) || duration <= 0 || duration > 1440) {
      activitiesDropped++;
      continue; // drop zero, negative, or impossibly large durations
    }

    let isRepetitiveStr = (row.is_repetitive || '').toString().trim().toLowerCase();
    let isRepetitive = ['true', '1', 'yes'].includes(isRepetitiveStr);

    let dateStr = row.timestamp?.trim();
    let timestampObj = new Date(dateStr);
    
    // basic normalizer for dd/mm/yyyy
    if (dateStr.includes('/')) {
        const parts = dateStr.split(/[\/\s:]/);
        if (parts.length >= 3) {
            if (parts[2].length === 4) { // dd/mm/yyyy
                timestampObj = new Date(\`\${parts[2]}-\${parts[1]}-\${parts[0]}T\${parts[3] || '00'}:\${parts[4] || '00'}:00Z\`);
                activitiesFixed++;
            }
        }
    }

    const timestamp = timestampObj.toISOString();
    const date = timestamp.split('T')[0];

    activities.push({
      employeeId: empId,
      department: employeesMap[empId].department,
      timestamp,
      date,
      appUsed,
      taskCategory,
      durationMinutes: duration,
      isRepetitive,
    });
  }

  cachedData = {
    employees: employeesMap,
    activities,
    stats: {
      employeesTotal: Object.keys(employeesMap).length,
      employeesDropped,
      activitiesTotal: activities.length,
      activitiesDropped,
      activitiesFixed,
    }
  };

  return cachedData;
}
