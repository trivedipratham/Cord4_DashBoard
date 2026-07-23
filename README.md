# Cord4 Automation Insights Dashboard

## Live URL
[Insert your Vercel URL here]

## Methodology & Assumptions

### 1. Data Ingestion & Normalization (`src/lib/data.ts`)
The raw files `activity_logs.csv` and `employees.json` were intentionally dirty. Here is how conflicts were resolved to form the in-memory dataset:
- **Missing Employees:** Employees found in the CSV but not in the HRMS JSON were retained as "Unknown Employee" with an imputed salary of 0. This ensures we don't silently lose activity data (time sink visibility) while acknowledging we cannot calculate their INR impact.
- **Duplicate Employees:** In the HRMS JSON, duplicate `EmployeeID` instances were handled by keeping the first encountered record. 
- **Salary Normalization:** Salaries came in three formats. 
  - `LPA`: Multiplied by 100,000 and divided by 12.
  - `Annual CTC INR`: Divided by 12.
  - `Hourly Rate`: Multiplied by 160 (assuming a standard 160-hour work month) to get the monthly base.
- **Data Cleansing:** Strings for `app_used` and `task_category` were lowercased and stripped of extra whitespace to prevent duplicates like "Gmail", "gmail", and " Gmail ". Invalid durations (negative, 0, or impossibly large > 1440 mins) were entirely dropped as anomalies. Timestamp formats were standardized to ISO format.

### 2. Headline Numbers
- **Hours Recoverable:** Calculated by summing the durations of all activities flagged as `is_repetitive = true` and multiplying by an assumed **60% automation potential factor**. 
- **Value Recoverable (INR):** Calculated by multiplying each employee's "Hours Recoverable" by their normalized hourly rate (`salaryMonthlyINR / 160`).

### 3. Automation Priority Ranking
To determine the best ROI for automation, task categories are ranked using a custom composite score:
**Score = (Volume in Hrs × Repetitive % × Number of Impacted Staff) + (Total Cost Impact in INR / 1000)**
*Justification:* A high-volume task that is highly repetitive and impacts many employees is much easier to automate globally than a niche task done by one person. We add scaled cost impact to prioritize tasks that drain expensive resources.

### 4. Anomaly Detection
The anomaly engine flags any employee with > 10 hours of total logged time where **> 80% of their time is non-repetitive**. 
*Justification:* High variance in manual tasks suggests a workflow that lacks standardization, or someone doing highly specialized, ad-hoc work that might need better tooling. 

### 5. AI Assistant Grounding
The AI chat widget strictly utilizes the Google `gemini-3.5-flash` model. To prevent hallucinations, the model's system prompt is injected at runtime with the exact aggregate figures, scores, and top priority tasks calculated from the normalized in-memory dataset. It cannot make up data because it only "knows" what the dashboard explicitly feeds it.

## Trade-offs & Future Improvements
- **In-Memory Limits:** Parsing a CSV in-memory via Next.js is fine for this dataset size but would not scale to millions of rows. For a production app, a dedicated ETL pipeline into PostgreSQL would be required.
- **Cross-Filtering:** The department filter works globally across the dashboard, and the task category filter dynamically updates the employee list. With more time, a robust global state management (Zustand or Context) could be implemented for N-way cross-filtering across all charts simultaneously.
