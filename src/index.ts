#!/usr/bin/env bun
import { Command } from "commander";
import { loadConfig, saveConfig } from "./config.js";
import { NewsDB, NewsItem } from "./db.js";
import { queryGrok } from "./grok.js";
import { formatCompact, formatFull, formatSources } from "./formatter.js";
import process from "node:process";
import OpenAI from "openai"

const program = new Command();
let cfg: any;
try {
  cfg = loadConfig();
} catch (e: any) {
  if (e.message.includes("config.json")) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}

// -------------------------------------------------
//  set-api-key
// -------------------------------------------------
program
  .command("set-api-key <key>")
  .description("Set your xAI Grok API key")
  .action((key: string) => {
    saveConfig({ grok: { apiKey: key } });
  });

// -------------------------------------------------
//  add-subject
// -------------------------------------------------
program
  .command("add-subject <name>")
  .option("-i, --id <id>", "Custom subject ID")
  .description("Register a new subject")
  .action((name: string, opts: { id?: string }) => {
    const db = new NewsDB(cfg);
    const id = db.addSubject(name, opts.id);
    console.log(`Subject "${name}" → ID: ${id}`);
  });
  
// -------------------------------------------------
//  list-subjects
// -------------------------------------------------
program
  .command("list-subjects")
  .description("List all registered subjects")
  .action(() => {
    const db = new NewsDB(cfg);
    const subjects = db.listSubjects();

    if (subjects.length === 0) {
      console.log("No subjects registered.");
      return;
    }

    console.log(`Registered subjects (${subjects.length}):\n`);
    const maxId = Math.max(...subjects.map(s => s.id.length), 6);
    const maxName = Math.max(...subjects.map(s => s.name.length), 8);
    const header = `| ${"ID".padEnd(maxId)} | ${"Name".padEnd(maxName)} | Items | Last Updated       |`;
    console.log(header);
    console.log(`|${"-".repeat(maxId + 2)}-|${"-".repeat(maxName + 2)}-|-------|-------------------|`);

    subjects.forEach(s => {
      const count = String(s.count).padEnd(5);
      const last = s.last_datetime
        ? new Date(s.last_datetime).toLocaleString()
        : "Never";
      console.log(`| ${s.id.padEnd(maxId)} | ${s.name.padEnd(maxName)} | ${count} | ${last} |`);
    });
  });
// -------------------------------------------------
//  ingest
// -------------------------------------------------
program
  .command("ingest")
  .requiredOption("-i, --id <subjectId>", "Subject ID")
  .description("Fetch and store news")
  .action(async (opts: { id: string }) => {
    const db = new NewsDB(cfg);
    const name = db.getSubjectName(opts.id);
    if (!name) throw new Error("Subject not found");

    const last = db.getLastDate(opts.id);
    const requeries = db.getRequeries(opts.id);
    const items = (await queryGrok(cfg, name, last, requeries)) as NewsItem[];

    if (items.length === 0) {
      console.log("No new items.");
      return;
    }
    db.insertItems(opts.id, items);
    console.log(`Appended ${items.length} item(s).`);
  });

// -------------------------------------------------
//  query
// -------------------------------------------------
program
  .command("query")
  .requiredOption("-i, --id <subjectId>", "Subject ID")
  .option("-l, --limit <n>", "Max items", "30")
  .option("-e, --expand <positions>", "Expand details")
  .action((opts: { id: string; limit: string; expand?: string }) => {
    const db = new NewsDB(cfg);
    const name = db.getSubjectName(opts.id);
    if (!name) throw new Error("Subject not found");

    const limit = parseInt(opts.limit, 10);
    const rows = db.queryLog(opts.id, limit);
    const expand = opts.expand ? new Set(opts.expand.split(",").map(Number)) : new Set();

    rows.forEach((row, i) => {
      const pos = i + 1;
      if (expand.has(pos)) {
        console.log(formatFull(row));
        console.log("---");
      } else {
        console.log(formatCompact(pos, row));
      }
    });
  });

// -------------------------------------------------
//  sources
// -------------------------------------------------
program
  .command("sources")
  .requiredOption("-i, --id <subjectId>", "Subject ID")
  .requiredOption("-p, --positions <list>", "Positions")
  .action((opts: { id: string; positions: string }) => {
    const db = new NewsDB(cfg);
    const name = db.getSubjectName(opts.id);
    if (!name) throw new Error("Subject not found");

    const positions = opts.positions.split(",").map(Number);
    const limit = Math.max(...positions, 50);
    const rows = db.queryLog(opts.id, limit);

    positions.forEach(pos => {
      const item = rows[pos - 1];
      if (item) {
        console.log(formatSources(pos, item));
        console.log("---");
      }
    });
  });

// -------------------------------------------------
//  requery
// -------------------------------------------------
program
  .command("requery")
  .requiredOption("-i, --id <subjectId>", "Subject ID")
  .requiredOption("-p, --position <pos>", "Item position")
  .requiredOption("-n, --paragraphs <n>", "Paragraphs", "1")
  .argument("<question...>")
  .action(async (qparts: string[], opts: { id: string; position: string; paragraphs: string }) => {
    const db = new NewsDB(cfg);
    const name = db.getSubjectName(opts.id);
    if (!name) throw new Error("Subject not found");

    const pos = parseInt(opts.position, 10);
    const paras = parseInt(opts.paragraphs, 10);
    const question = qparts.join(" ");

    const rows = db.queryLog(opts.id, pos);
    const item = rows[pos - 1];
    if (!item) throw new Error(`Position ${pos} not found`);

    const reqId = db.saveRequery(opts.id, item.rowid, question, paras);

    const prompt = `
About the following subject: "${item.summary}"

${question}

Return exactly ${paras} paragraph(s).
`.trim();

    console.log(`\nAsking Grok...\n`);
    console.log(prompt)
    const client = new OpenAI({
        apiKey: cfg.grok.apiKey,
        baseURL: "https://api.x.ai/v1",
        timeout: 360000, // Override default timeout with longer timeout for reasoning models
    });
  const response = await client.responses.create(
    {
      model: "grok-4-fast",
      input: [{ role: "user", content: prompt }],
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

  
    const answer = response.output_text;
    db.saveRequeryAnswer(reqId, answer);

    console.log(`\nAnswer (${paras} para(s)):\n\n${answer}\n`);
    console.log("Quote saved.");
  });

// -------------------------------------------------
//  list-requeries
// -------------------------------------------------
program
  .command("list-requeries")
  .requiredOption("-i, --id <subjectId>", "Subject ID")
  .option("-p, --positions <list>", "Filter by positions")
  .option("--answered", "Only answered")
  .option("--pending", "Only pending")
  .action((opts: { id: string; positions?: string; answered?: boolean; pending?: boolean }) => {
    const db = new NewsDB(cfg);
    const name = db.getSubjectName(opts.id);
    if (!name) throw new Error("Subject not found");

    const targetPos = opts.positions ? new Set(opts.positions.split(",").map(Number)) : null;

    let sql = `
      SELECT r.id, r.log_rowid, r.question, r.answer, r.paragraphs, r.created_at,
             n.summary
      FROM requeries r
      JOIN news_logs n ON r.log_rowid = n.rowid
      WHERE r.subject_id = ?
    `;
    const params: any[] = [opts.id];

    if (opts.answered) sql += ` AND r.answer IS NOT NULL`;
    if (opts.pending) sql += ` AND r.answer IS NULL`;

    sql += ` ORDER BY r.created_at DESC`;
    const rows = db.db.prepare(sql).all(...params);

    if (rows.length === 0) {
      console.log("No requeries.");
      return;
    }

    const logRows = db.queryLog(opts.id, 1000);
    const rowidToPos = new Map<number, number>();
    logRows.forEach((r, i) => rowidToPos.set(r.rowid, i + 1));

    const filtered = targetPos
      ? rows.filter((r : any) => {
          const pos = rowidToPos.get(r.log_rowid);
          return pos && targetPos.has(pos);
        })
      : rows;

    if (filtered.length === 0) {
      console.log("No matching requeries.");
      return;
    }

    console.log(`Requeries for "${name}" (${filtered.length}):\n`);
    filtered.forEach((r: any, i: number) => {
      const pos = rowidToPos.get(r.log_rowid) || "?";
      const status = r.answer ? "Answered" : "Pending";
      const date = new Date(r.created_at).toLocaleString();
      console.log(`${i + 1}. [${pos}] ${status} [${r.paragraphs} para]`);
      console.log(`   Q: ${r.question}`);
      console.log(`   Summary: ${r.summary.substring(0, 90)}...`);
      if (r.answer) {
        console.log(`   A: ${r.answer}`);
      }
      console.log(`   Created: ${date}\n`);
    });
  });

program.parse();