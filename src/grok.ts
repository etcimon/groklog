import { Config } from "./config.js";
import OpenAI from "openai"

export interface NewsItem {
  datetime: string;
  importance: number;
  summary: string;
  details: string;
  source_urls?: string;
}

export async function queryGrok(
  cfg: Config,
  subject: string,
  lastDate: string,
  requeries: Array<{ log_rowid: number; question: string; answer?: string|null }> = []
): Promise<NewsItem[]> {
  let context = "";
  if (requeries.length > 0) {
    context = "\n\n--- PREVIOUS REQUERIES ---\n";
    for (const q of requeries) {
      const prefix = q.answer ? "[Answered]" : "[Pending]";
      context += `${prefix} On summary #${q.log_rowid}: "${q.question}"\n`;
      if (q.answer) context += `Answer: ${q.answer}\n\n`;
    }
    context += "--- END ---\n";
  }

    const client = new OpenAI({
        apiKey: cfg.grok.apiKey,
        baseURL: "https://api.x.ai/v1",
        timeout: 360000, // Override default timeout with longer timeout for reasoning models
    });

  const prompt = (cfg.grok.promptTemplate || "")
    .replace("{subject}", subject)
    .replace("{lastDate}", lastDate)
    + context;

  const response = await client.responses.create(
    {
      model: "grok-4-fast",
      input: [{role: "system", content: cfg.grok.systemPrompt}, { role: "user", content: prompt }],
      tools: [{ type: "web_search" }, { type: "x_search"}],
      stream: false
    } as any
 );

    if (
        response.status === "incomplete" &&
        response.incomplete_details?.reason === "max_output_tokens"
    ) {
        console.log("Ran out of tokens");
        if (response.output_text?.length > 0) {
            console.log("Partial output:", response.output_text);
        } else {
            console.log("Ran out of tokens during reasoning");
        }
    }
    
  if (!response.output_text) throw new Error(`Grok API error: ${response.status}`);
  let data = JSON.parse(response.output_text);
  return data as NewsItem[];
}