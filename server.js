require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");
const path = require("path");
const XLSX = require("xlsx");

const app = express();
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const REQUESTED_PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, "public");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString("hex");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Set it in your environment.");
  process.exit(1);
}
if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.error("ADMIN_USERNAME and ADMIN_PASSWORD are required.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC, { etag: true, maxAge: "1h" }));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id TEXT PRIMARY KEY,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      team_name TEXT NOT NULL,
      leader TEXT NOT NULL,
      college TEXT NOT NULL,
      department TEXT DEFAULT '',
      year TEXT DEFAULT '',
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      members TEXT DEFAULT '',
      member_names TEXT DEFAULT '',
      project TEXT DEFAULT '',
      abstract TEXT DEFAULT ''
    )
  `);
  // Safe migration for databases created by older versions.
  await pool.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS member_names TEXT DEFAULT ''`);
}

function clean(value) { return String(value ?? "").trim(); }

function signSession(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function parseCookies(req) {
  const raw = req.get("cookie") || "";
  return Object.fromEntries(raw.split(";").map(x => x.trim()).filter(Boolean).map(x => {
    const i = x.indexOf("="); return i < 0 ? [x, ""] : [x.slice(0, i), decodeURIComponent(x.slice(i + 1))];
  }));
}
function validSession(token) {
  try {
    if (!token || !token.includes(".")) return false;
    const [payload, sig] = token.split(".");
    const expected = crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(payload).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.u === ADMIN_USERNAME && Number(data.exp) > Date.now();
  } catch { return false; }
}
function requireAdmin(req, res, next) {
  const auth = req.get("authorization") || "";
  const cookieToken = parseCookies(req).invictus_admin;
  if (auth === `Bearer ${cookieToken}` && validSession(cookieToken)) return next();
  if (validSession(cookieToken)) return next();
  return res.status(401).json({ ok: false, message: "Unauthorized" });
}

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/api/admin/session", requireAdmin, (req, res) => res.json({ ok: true }));
app.post("/api/admin/logout", (req, res) => { res.setHeader("Set-Cookie", "invictus_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"); res.json({ ok: true }); });

app.post("/api/admin/login", (req, res) => {
  const username = clean(req.body?.username);
  const password = String(req.body?.password ?? "");
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, message: "Invalid username or password" });
  }
  const token = signSession(ADMIN_USERNAME);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `invictus_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`);
  res.json({ ok: true });
});

app.post("/api/register", async (req, res) => {
  try {
    const b = req.body || {};
    const teamName = clean(b.teamName);
    const leader = clean(b.leader);
    const college = clean(b.college);
    const phone = clean(b.phone);
    const email = clean(b.email);
    const members = Number.parseInt(clean(b.members), 10);
    if (!teamName || !leader || !college || !phone || !email || !Number.isInteger(members)) {
      return res.status(400).json({ ok: false, message: "Please complete all required fields." });
    }
    if (members < 1 || members > 3) {
      return res.status(400).json({ ok: false, message: "A team can have a maximum of 3 members." });
    }

    const id = "INV-" + Date.now().toString(36).toUpperCase();
    await pool.query(
      `INSERT INTO registrations
       (id, team_name, leader, college, department, year, phone, email, members, member_names, project, abstract)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, teamName, leader, college, clean(b.department), clean(b.year), phone, email,
       String(members), clean(b.memberNames), clean(b.project), clean(b.abstract)]
    );
    res.json({ ok: true, id, teamName, leader });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ ok: false, message: "Could not save registration." });
  }
});

app.get("/api/admin/registrations", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, submitted_at AS "submittedAt", team_name AS "teamName", leader, college,
             department, year, phone, email, members, member_names AS "memberNames", project, abstract
      FROM registrations ORDER BY submitted_at DESC
    `);
    res.json({ ok: true, registrations: rows });
  } catch (err) {
    console.error("Admin query error:", err);
    res.status(500).json({ ok: false, message: "Could not load registrations." });
  }
});

app.delete("/api/admin/registrations/:id", requireAdmin, async (req, res) => {
  try {
    const id = clean(req.params.id);
    if (!id) return res.status(400).json({ ok: false, message: "Registration ID is required." });
    const result = await pool.query("DELETE FROM registrations WHERE id=$1", [id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, message: "Registration not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error("Admin delete error:", err);
    res.status(500).json({ ok: false, message: "Could not delete registration." });
  }
});

app.put("/api/admin/registrations/:id", requireAdmin, async (req, res) => {
  try {
    const id = clean(req.params.id);
    const b = req.body || {};
    const teamName = clean(b.teamName), leader = clean(b.leader), college = clean(b.college);
    const phone = clean(b.phone), email = clean(b.email);
    const members = Number.parseInt(clean(b.members), 10);
    if (!id || !teamName || !leader || !college || !phone || !email || !Number.isInteger(members)) {
      return res.status(400).json({ ok: false, message: "Please complete the required fields." });
    }
    if (members < 1 || members > 3) {
      return res.status(400).json({ ok: false, message: "A team can have a maximum of 3 members." });
    }
    const result = await pool.query(
      `UPDATE registrations SET team_name=$1, leader=$2, college=$3, department=$4, year=$5,
       phone=$6, email=$7, members=$8, member_names=$9, project=$10, abstract=$11
       WHERE id=$12`,
      [teamName, leader, college, clean(b.department), clean(b.year), phone, email,
       String(members), clean(b.memberNames), clean(b.project), clean(b.abstract), id]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, message: "Registration not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error("Admin update error:", err);
    res.status(500).json({ ok: false, message: "Could not update registration." });
  }
});

function pdfEscape(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[\r\n]+/g, " ");
}

function buildRegistrationPdf(rows) {
  const linesPerPage = 38;
  const pages = [];
  const generated = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const header = [
    "INVICTUS 2026 - REGISTRATION LIST",
    `Generated: ${generated} | Total registrations: ${rows.length}`,
    "",
    "ID | TEAM | LEADER | COLLEGE | PHONE | EMAIL | PROJECT",
    "-".repeat(120)
  ];
  const body = rows.map(r =>
    [r.id, r.teamName, r.leader, r.college, r.phone, r.email, r.project]
      .map(v => String(v ?? "").replace(/\s+/g, " ").trim()).join(" | ")
  );
  const allLines = header.concat(body);
  for (let i = 0; i < allLines.length; i += linesPerPage) pages.push(allLines.slice(i, i + linesPerPage));
  if (!pages.length) pages.push(header);

  const objects = [];
  const add = str => { objects.push(str); return objects.length; };
  const catalogId = add(null), pagesId = add(null), pageIds = [];
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  for (const pageLines of pages) {
    let stream = "BT\n/F1 7 Tf\n9 TL\n36 806 Td\n";
    pageLines.forEach((line, idx) => {
      const size = idx === 0 ? 12 : 7;
      if (idx === 0) stream += `/F1 ${size} Tf\n`;
      stream += `(${pdfEscape(line.slice(0, 145))}) Tj\nT*\n`;
      if (idx === 0) stream += `/F1 7 Tf\n`;
    });
    stream += "ET";
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
    const pageId = add(null); pageIds.push(pageId);
    objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  let pdf = "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n"; const offsets = [0];
  objects.forEach((obj, idx) => { offsets.push(Buffer.byteLength(pdf, "binary")); pdf += `${idx + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, "binary"); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "binary");
}

async function fetchRegistrations() {
  const { rows } = await pool.query(`
    SELECT id, submitted_at AS "submittedAt", team_name AS "teamName", leader, college,
           department, year, phone, email, members, member_names AS "memberNames", project, abstract
    FROM registrations ORDER BY submitted_at DESC
  `);
  return rows;
}

app.get("/api/admin/registrations.pdf", requireAdmin, async (req, res) => {
  try {
    const rows = await fetchRegistrations();
    const pdf = buildRegistrationPdf(rows);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="INVICTUS-2026-registrations-${new Date().toISOString().slice(0,10)}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error("PDF export error:", err);
    if (!res.headersSent) res.status(500).json({ ok: false, message: "Could not generate PDF." });
  }
});

app.get("/api/admin/registrations.xlsx", requireAdmin, async (req, res) => {
  try {
    const rows = await fetchRegistrations();
    const exportRows = rows.map(r => ({
      "Registration ID": r.id,
      "Submitted At": r.submittedAt ? new Date(r.submittedAt).toLocaleString("en-IN") : "",
      "Team Name": r.teamName,
      "Team Leader": r.leader,
      "College": r.college,
      "Department": r.department,
      "Year / Semester": r.year,
      "Phone": r.phone,
      "Email": r.email,
      "Team Members": r.members,
      "Member Names": r.memberNames,
      "Project Title": r.project,
      "Project Description": r.abstract
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows);
    ws["!cols"] = [
      {wch:18},{wch:22},{wch:24},{wch:24},{wch:30},{wch:16},{wch:16},{wch:18},
      {wch:32},{wch:14},{wch:32},{wch:30},{wch:60}
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Registrations");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="INVICTUS-2026-registrations-${new Date().toISOString().slice(0,10)}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error("Excel export error:", err);
    if (!res.headersSent) res.status(500).json({ ok: false, message: "Could not generate Excel file." });
  }
});

app.get("/admin/login", (req, res) => res.sendFile(path.join(PUBLIC, "admin-login.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(PUBLIC, "admin.html")));
app.get("/registration-success", (req, res) => res.sendFile(path.join(PUBLIC, "registration-success.html")));

async function startServer() {
  await initDb();
  const start = (port) => new Promise((resolve, reject) => {
    const server = app.listen(port, "0.0.0.0", () => resolve(server));
    server.once("error", (err) => reject(err));
  });

  try {
    const server = await start(REQUESTED_PORT);
    console.log(`INVICTUS 2026 running on port ${REQUESTED_PORT}`);
    return server;
  } catch (err) {
    if (!IS_PRODUCTION && err && err.code === "EADDRINUSE" && REQUESTED_PORT === 3000) {
      const fallback = 3001;
      const server = await start(fallback);
      console.log(`Port 3000 is busy; INVICTUS 2026 running on port ${fallback}`);
      return server;
    }
    throw err;
  }
}

startServer().catch(err => {
  console.error("Startup failed:", err);
  process.exit(1);
});
