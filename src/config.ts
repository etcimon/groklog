import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const ConfigSchema = z.object({
  grok: z.object({
    apiKey: z.string().optional(),
    baseUrl: z.string().default("https://api.x.ai/v1").optional(),
    promptTemplate: z.string().optional(),
    systemPrompt: z.string().optional()
  }),
  db: z.object({
    path: z.string().default("./groknews.db").optional()
  })
});

export type Config = z.infer<typeof ConfigSchema>;

const CONFIG_PATH = resolve("./config.json");

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error("config.json not found. Run: groklog set-api-key <your-key>");
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  return ConfigSchema.parse(raw);
}

function deepMerge(obj1:any, obj2:any) {
  for (let key in obj2) {
    if (obj2.hasOwnProperty(key)) {
      if (obj2[key] instanceof Object && obj1[key] instanceof Object) {
        obj1[key] = deepMerge(obj1[key], obj2[key]);
      } else {
        obj1[key] = obj2[key];
      }
    }
  }
  return obj1;
}

export function saveConfig(config: Partial<Config>) {
  const current = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) : {};
  const updated = deepMerge(current, config);
  writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
  console.log("config.json updated.");
}