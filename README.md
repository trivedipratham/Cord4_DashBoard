# AI Analytics Dashboard - Methodology

This document outlines the methodology, data processing assumptions, technical decisions, and future plans for the AI Analytics Dashboard, addressing the COO's core question: *"where are we wasting the most time and money, and what should we automate first?"*

## 1. Data Assumptions & Join Strategy

### `activity_logs.csv` Assumptions:
- **Timestamps**: Expected in IST. Variations in formatting (e.g., slash-style `dd/mm/yyyy` vs. ISO `yyyy-mm-dd`) were programmatically identified and normalized into standard ISO 8601 strings.
- **Durations**: Empty strings, negatives, zeros, and impossibly large values (> 1440 mins/24 hours) were treated as logging errors and dropped from the dataset to prevent skewing the recoverable hours.
- **Repetitiveness**: Variations like `1`, `yes`, and `True` (mixed casing) were strictly evaluated and cast to `true`; all other variations were cast to `false`.

### `employees.json` Assumptions & Join Strategy:
- **Schema Conflicts**: The mid-year migration caused disparate shapes (e.g., `employee_id` vs `EmployeeID`, flat salary vs nested `meta.compensation`). We normalized this by taking a "most complete" extraction approach, checking multiple possible JSON paths for salaries and roles, and consolidating them into a strict TypeScript `Employee` interface.
- **Join Strategy**: A left join was performed using the activity logs as the primary fact table. The keys were `employee_id` (trimmed and lowercased to prevent casing mismatches).
- **Conflict Resolution**:
  - **Duplicate HRMS records**: We kept the first active/complete record for an ID and dropped duplicates.
  - **Missing Employees**: If an employee logged activity but was missing from the HRMS export, a "dummy" employee profile was created with a zero-rupee salary. Their hours are counted in the time-sink breakdown, but excluded from the Rupee impact.
  - **Extra Employees**: Employees in the HRMS with no activity logs were retained in the memory map but do not impact automation priorities.

## 2. Formulas and Metrics

### Headline Numbers
- **Hours Recoverable**: `Sum of (Repetitive Minutes * 60%) / 60`
  *Assumption: We conservatively assume only 60% of a repetitive task can be realistically automated away, leaving 40% for edge cases or human review. This makes the figure defensible to executive scrutiny.*
- **Value Recoverable (INR)**: `Sum of (Individual Repetitive Hours * 60% * Individual Hourly Rate)`
  *The calculation is strictly line-by-line. We calculate an employee's hourly rate (`Monthly Salary / 160`) and apply it directly to their specific repetitive hours. This prevents the "average salary fallacy" and produces an exact monetary impact.*

### Automation Priority Ranking
`Score = (Volume * Repetitive % * Employee Concentration) + (Cost Impact / 1000)`
- **Why this formula?**: Volume alone isn't enough. A high-volume task done by only one person (low concentration) is a workflow problem, not a systemic automation opportunity. A task done by many people (high concentration) with a high repetitive % represents standardized waste. We add `Cost Impact / 1000` as a tie-breaker so expensive waste ranks higher.

## 3. Anomaly Detection
The anomaly detection scans for **Rogue Workflows**.
- **Approach**: It flags any employee who has logged a significant amount of time (> 10 hours) but has an extremely low repetitive task share (< 20%, i.e., > 80% manual work). 
- **Why**: In a typical corporate environment, highly manual work at large volumes indicates an employee is either bypassing standard automated tooling or is stuck in an unoptimized, undocumented process that needs immediate managerial review.

## 4. What Was Cut and Why
- **Backend Database (PostgreSQL/Prisma)**: Cut. The prompt demanded an "in-memory dataset" to prove algorithmic processing of messy data. Setting up a full database would complicate local execution without adding analytical value for a ~540 row dataset.
- **User Authentication**: Cut. The COO wants an executive summary tool to answer a specific question. An identity management layer adds friction without business value.
- **Complex Multi-page Routing**: Cut. A single-page dashboard with cross-filtering provides a vastly superior "executive summary" experience than clicking through multiple metric pages.

## 5. What I'd Build With Two More Days
1. **Persistent Pipeline**: Migrate the in-memory ingestion logic to a scheduled Cron job that writes to a PostgreSQL database, enabling historic Year-over-Year tracking.
2. **Advanced Date Filtering**: Add a granular date-range picker (e.g., "Last 7 Days", "Last Quarter") that dynamically recalculates all charts and the AI context.
3. **Streaming AI Responses**: Implement Next.js AI SDK streaming for the Gemini API to reduce perceived latency on complex analytical questions.
4. **CSV Export**: Alongside the PNG Executive Summary, allow analysts to download the cleaned, joined dataset as a CSV for their own Excel pivot tables.
