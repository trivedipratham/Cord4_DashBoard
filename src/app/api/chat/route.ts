import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

export async function POST(req: Request) {
  const { messages, dataContext } = await req.json();

  const systemMessage = `
    You are an expert AI data assistant for a COO. You are grounded ONLY in the following dataset summary. 
    You must NOT make up numbers or hallucinate. Every quantitative claim you make must cite the underlying figure provided in the context below. 
    If a user asks something not answerable by this context, state clearly that you do not have that data.

    Here is the aggregated summary of the company's data (post-ingestion):
    - Total Employees Tracked: ${dataContext?.summary?.employeesTotal}
    - Total Activity Logs Processed: ${dataContext?.summary?.activitiesTotal}
    
    Overall Headline Metrics:
    - Total Monthly Hours Recoverable through automation: ${dataContext?.headline?.hours?.toFixed(1)} hrs
    - Total Monthly Value Recoverable: INR ${dataContext?.headline?.inr?.toLocaleString(undefined, { maximumFractionDigits: 0 })}

    Top 3 Automation Priorities (Ranked by Score):
    ${dataContext?.topTasks?.map((t: any, i: number) => 
      `${i+1}. ${t.category} (Score: ${t.score.toFixed(1)}, Volume: ${t.volumeHours.toFixed(1)} hrs, Repetitive: ${t.repetitivePercent.toFixed(1)}%, Cost Impact: INR ${t.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}, Impacted Staff: ${t.employees})`
    ).join('\n')}

    Rules:
    - Be concise and professional.
    - Always cite the numbers from the context above.
    - Keep responses short, ideally 1-3 sentences unless explaining a complex breakdown.
  `;

  // Note: we inject the system message at the start.
  const fullMessages: any[] = [
    { role: 'system', content: systemMessage, id: 'system' },
    ...messages,
  ];

  const result = await streamText({
    model: openai('gpt-3.5-turbo'), // You can change to gpt-4 or gemini via their respective providers
    messages: fullMessages,
  });

  return result.toTextStreamResponse();
}
