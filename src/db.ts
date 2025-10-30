import {Database} from "bun:sqlite";
import { Config } from "./config.js";

export interface NewsItem {
  rowid: number;
  datetime: string;
  importance: number;
  summary: string;
  details: string;
  source_urls?: string;
}

export class NewsDB {
  db: Database;

  constructor(cfg: Config) {
    this.db = new Database(cfg.db.path, {create: true, strict: true});
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subjects (
        id   TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS news_logs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        datetime   TEXT NOT NULL,
        importance INTEGER NOT NULL CHECK(importance BETWEEN 1 AND 10),
        summary    TEXT NOT NULL,
        details    TEXT,
        source_urls TEXT,
        UNIQUE(subject_id, summary)
      );

      CREATE TABLE IF NOT EXISTS requeries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id  TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        log_rowid   INTEGER NOT NULL,
        question    TEXT NOT NULL,
        answer      TEXT,
        paragraphs  INTEGER NOT NULL,
        created_at  TEXT DEFAULT (datetime('now')),
        UNIQUE(subject_id, log_rowid, question)
      );

      CREATE INDEX IF NOT EXISTS idx_subject_dt ON news_logs(subject_id, datetime DESC);
      CREATE INDEX IF NOT EXISTS idx_requery_subject ON requeries(subject_id);
    `);
  }

  addSubject(name: string, id?: string): string {
    const subjectId = id ?? name.toLowerCase().replace(/\s+/g, "-");
    this.db.prepare(`INSERT OR IGNORE INTO subjects (id, name) VALUES (?, ?)`).run(subjectId, name);
    return subjectId;
  }

  listSubjects(): Array<{
  id: string;
  name: string;
  count: number;
  last_datetime: string | null;
}> {
  return this.db.prepare(`
    SELECT 
      s.id,
      s.name,
      COUNT(n.id) as count,
      MAX(n.datetime) as last_datetime
    FROM subjects s
    LEFT JOIN news_logs n ON n.subject_id = s.id
    GROUP BY s.id, s.name
    ORDER BY s.name
  `).all() as Array<{
  id: string;
  name: string;
  count: number;
  last_datetime: string | null;
}>;
}

  getSubjectName(id: string): string | null {
    const row = this.db.prepare(`SELECT name FROM subjects WHERE id = ?`).get(id) as any;
    return row ? row.name : null;
  }

  getLastDate(subjectId: string): string {
    const row = this.db.prepare(`
      SELECT datetime FROM news_logs WHERE subject_id = ? ORDER BY datetime DESC LIMIT 1
    `).get(subjectId) as any;
    return row?.datetime ?? "1970-01-01T00:00:00Z";
  }

  insertItems(subjectId: string, items: NewsItem[]) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO news_logs
        (subject_id, datetime, importance, summary, details, source_urls)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction((items: NewsItem[]) => {
      for (const it of items) stmt.run(subjectId, it.datetime, it.importance, it.summary, it.details, it.source_urls ?? null);
    });
    tx(items);
  }

  queryLog(subjectId: string, limit = 50): (NewsItem & { rowid: number; source_urls: string | null })[] {
    return this.db.prepare(`
      SELECT id as rowid, datetime, importance, summary, details, source_urls
      FROM news_logs
      WHERE subject_id = ?
      ORDER BY datetime DESC
      LIMIT ?
    `).all(subjectId, limit) as any;
  }

  saveRequery(subjectId: string, logRowId: number, question: string, paragraphs: number): number {
    const info = this.db.prepare(`
      INSERT INTO requeries (subject_id, log_rowid, question, paragraphs)
      VALUES (?, ?, ?, ?)
    `).run(subjectId, logRowId, question, paragraphs);
    return info.lastInsertRowid as number;
  }

  saveRequeryAnswer(requeryId: number, answer: string) {
    this.db.prepare(`UPDATE requeries SET answer = ? WHERE id = ?`).run(answer, requeryId);
  }

  getRequeries(subjectId: string): Array<{
    log_rowid: number;
    question: string;
    answer: string | null;
  }> {
    return this.db.prepare(`
      SELECT log_rowid, question, answer
      FROM requeries
      WHERE subject_id = ?
      ORDER BY created_at
    `).all(subjectId) as Array<{
    log_rowid: number;
    question: string;
    answer: string | null;
  }>;
  }
}