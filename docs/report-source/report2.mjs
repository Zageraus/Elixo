// Builds the ELIXOR project report (student report layout) and prints it to PDF with headless Edge.
// Uses the real screenshots in img/, the live query output in db_evidence.json and the API calls in api_evidence.json.
// Printed twice: the first PDF is read back with pdf.js to find the page of each section for the contents page.
import { readFileSync, writeFileSync } from "fs";
import { launch } from "./cdp.mjs";

const here = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const OUT_PDF = process.argv[2] ?? here("./report2.pdf");
const db = JSON.parse(readFileSync(here("./db_evidence.json"), "utf-8"));
const api = JSON.parse(readFileSync(here("./api_evidence.json"), "utf-8"));
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- helpers ----------
const fig = (src, caption, width = 100) =>
  `<figure><img src="img/${src}" style="max-width:${width}%"><figcaption>${caption}</figcaption></figure>`;

function prettySql(sql) {
  return sql
    .replace(/\s+/g, " ")
    .replace(/ (from|join|left join|where|group by|having|order by|limit) /gi, (m, k) => `\n${k.toUpperCase()} `)
    .replace(/^select /i, "SELECT ")
    .replace(/\nLEFT JOIN /g, "\n  LEFT JOIN ")
    .replace(/\nJOIN /g, "\n  JOIN ")
    .trim() + ";";
}
function psqlTable(rows, maxRows = 99) {
  if (!rows.length) return "(0 rows)";
  const cols = Object.keys(rows[0]);
  const shown = rows.slice(0, maxRows);
  const val = (v) => (v === null || v === undefined ? "" : String(v));
  const num = (c) => shown.every((r) => typeof r[c] === "number" || r[c] === null);
  const w = cols.map((c) => Math.min(48, Math.max(c.length, ...shown.map((r) => val(r[c]).length))));
  const cell = (s, i, c) => { s = s.length > w[i] ? s.slice(0, w[i] - 1) + "…" : s; return num(c) ? s.padStart(w[i]) : s.padEnd(w[i]); };
  const lines = [
    " " + cols.map((c, i) => c.padEnd(w[i])).join(" | "),
    "-" + w.map((n) => "-".repeat(n)).join("-+-") + "-",
    ...shown.map((r) => " " + cols.map((c, i) => cell(val(r[c]), i, c)).join(" | ")),
  ];
  if (rows.length > maxRows) lines.push(` ... ${rows.length - maxRows} more rows`);
  lines.push(`(${rows.length} row${rows.length === 1 ? "" : "s"})`);
  return lines.join("\n");
}
const query = (id, maxRows) => `<p class="label">Query:</p><pre class="code">${esc(prettySql(db[id].sql))}</pre><p class="label">Output:</p><pre class="out">${esc(psqlTable(db[id].rows, maxRows))}</pre>`;
const demo = (id) => `<pre class="out">${db[id].map(([cmd, res]) => `${esc(cmd)}${res ? `\n${esc(res)}` : ""}`).join("\n\n")}</pre>`;
const apiCall = (i) => {
  const c = api[i];
  const body = c.body ? `\n\n${esc(JSON.stringify(JSON.parse(c.body), null, 2))}` : "";
  let resp = JSON.stringify(c.response, null, 2);
  if (resp.split("\n").length > 22) resp = resp.split("\n").slice(0, 22).join("\n") + "\n  ...";
  return `<p class="label">Request:</p><pre class="code">${esc(c.request)}${body}</pre><p class="label">Response:</p><pre class="out">Status: ${c.status}\n${esc(resp)}</pre>`;
};
const todo = (what) => `<p class="todo">[Insert screenshot: ${what}]</p>`;

// ---------- commit table ----------
// commits.txt is `git log dev` of Zageraus/Elixo; f4548fd only exists in Arnahhh/HealthChain-Finalised.
const commits = readFileSync(here("./commits.txt"), "utf-8").trim().split(/\r?\n/).map((l) => {
  const [short, , date, author, email, , ...msg] = l.split("|");
  return { short, date, author, email, subject: msg.join("|") };
});
commits.splice(commits.findIndex((c) => c.short === "d534716"), 0,
  { short: "f4548fd", date: "16 Oct 2026 20:57", author: "Arna", email: "your_actual_github_email@gmail.com", subject: "Initial HealthChain project upload" });
// The first review saw the project up to a966cbe (login and appointment booking); everything after it is an improvement.
const REVIEW_BASELINE = "a966cbe";
const improvementIds = commits.slice(commits.findIndex((c) => c.short === REVIEW_BASELINE) + 1).map((c) => c.short);
const DEV_IDS = ["611694b", "4fa0cdd", "0cc5722", "6ff0fc6", "f0ef5fa", "ddd0827", "2ac37ae", "7bfab2a", "18918c0", "3959539", "6530d61", "925e4ec", "b0e7e8b"];
const SANIDHYA = { name: "Sanidhya Srivastava", reg: "24BCB0135", gh: "Zageraus", module: "Database" };
const ARNA = { name: "Arna Adhikari", reg: "24BDS0363", gh: "Arnahhh", module: "AI and Blockchain" };
// AI and blockchain work by Arna that was pushed from the Zageraus account.
const ARNA_VIA_ZAGERAUS = ["3050504", "d458724", "3198f74", "6530d61", "925e4ec", "b0e7e8b"];
const memberOf = (c) => (ARNA_VIA_ZAGERAUS.includes(c.short) ? ARNA : c.email === "ssanidhya886@gmail.com" ? SANIDHYA : ARNA);
const pushedFrom = (c) => (c.email === "ssanidhya886@gmail.com" ? "Zageraus" : c.email === "arnaadhikari2006@gmail.com" ? "Arnahhh" : "Arna*");
const branchOf = (c) => (c.short === "d534716" ? "healthchain-upgrade" : DEV_IDS.includes(c.short) ? "dev" : "main");
// The first of our repositories each commit was pushed to (later repositories carry the same history).
const IN_HC_AI = ["2f0ea0f", "705efb5", "b11eb92", "c41eb12", "8dda7ab", "5d09f0c", "bbedab8", "d534716", "ba54fd3", "ff5fd13"];
const repoOf = (c) => (c.short === "f4548fd" ? "HealthChain-Finalised" : IN_HC_AI.includes(c.short) ? "HealthChain-AI-and-BlockChain-integrated-" : ["224db02", "8abbccf"].includes(c.short) ? "Elixor-update" : "Elixo");
// Which part of the system each commit touches, from its changes.
const AREA = {
  "2f0ea0f": "Project setup", "705efb5": "Project setup", "b11eb92": "Project setup", "c41eb12": "Full stack (schema, API, contracts, AI)",
  "8dda7ab": "Documentation", "5d09f0c": "Frontend", "bbedab8": "Authentication", "f4548fd": "Full project (incl. AI service, contracts)",
  "d534716": "AI and Blockchain", "ba54fd3": "AI and Blockchain", "ff5fd13": "Project setup", "224db02": "Frontend",
  "8abbccf": "Frontend / Authentication", "a966cbe": "Database / Backend", "7a51624": "Frontend", "9390d47": "Authentication",
  "518f977": "Frontend", "a493dfa": "Database / Backend", "ae28df1": "Database / Backend", "e6f2c21": "Database",
  "3050504": "Blockchain", "c3a2945": "Database", "d4ba353": "Database / Backend", "6773bd4": "Database",
  "1835523": "Database", "c22f815": "Frontend", "d458724": "Blockchain", "4d66d95": "Backend", "174f6b5": "Documentation",
  "3198f74": "Blockchain", "611694b": "Database", "4fa0cdd": "Database", "0cc5722": "Database / Frontend",
  "6ff0fc6": "Frontend", "f0ef5fa": "Database", "ddd0827": "DevOps / Backup", "2ac37ae": "Documentation",
  "7bfab2a": "Backend", "18918c0": "Documentation", "3959539": "Deployment", "6530d61": "AI", "925e4ec": "AI", "b0e7e8b": "AI",
};
const memberCommits = (m) => commits.filter((c) => memberOf(c) === m);
const memberTable = (m) => `<p><b>${m.name} (${m.reg})</b>, GitHub ID ${m.gh}, ${m.module} module: ${memberCommits(m).length} commits.</p>
<table class="commits">
  <tr><th style="width:21%">Repository</th><th style="width:10%">Branch</th><th style="width:8%">Commit ID</th><th style="width:10%">Date</th><th>Commit message</th><th style="width:13%">Area</th><th style="width:10%">Pushed from</th></tr>
  ${memberCommits(m).map((c) => `<tr><td>${repoOf(c)}</td><td>${branchOf(c)}</td><td class="mono">${c.short}</td><td>${esc(c.date.slice(0, 11))}</td><td>${esc(c.subject)}</td><td>${AREA[c.short] ?? ""}</td><td>${pushedFrom(c)}</td></tr>`).join("")}
</table>`;
const improvements = commits.filter((c) => improvementIds.includes(c.short));
const impText = {
  "7a51624": "The patient dashboard now checks the user's role, and an error while loading the doctor list is shown instead of an empty list.",
  "9390d47": "If the saved login is no longer valid, the user is signed out automatically.",
  "518f977": "Fixed the booking and report upload forms not clearing after they were submitted.",
  "a493dfa": "Doctors can accept or decline appointments, and each dashboard only shows the logged in user's own data.",
  "ae28df1": "Doctors choose their specialization when signing up, and patients can filter doctors by it while booking.",
  "e6f2c21": "Added demo seed data (doctors, patients, appointments, prescriptions and reports) and turned on RLS for auth_nonces.",
  "3050504": "Prescriptions show the doctor's and patient's names, and only prescriptions that are really anchored on the blockchain get the anchored badge.",
  "c3a2945": "Added simulated consultation payments: payments table, checkout page and receipt.",
  "d4ba353": "Admins can deactivate or permanently delete patients and doctors.",
  "6773bd4": "Patients get a notification when their doctor is deactivated or deleted.",
  "1835523": "Fixed deleting users who have anchored records (migration 010 adds ON DELETE CASCADE to blockchain_transactions).",
  "c22f815": "The upload message now says what actually happened with the AI summary and the anchoring.",
  "d458724": "Report cards show the real anchoring status of each report.",
  "4d66d95": "Patients can open their uploaded PDFs through short-lived signed links.",
  "174f6b5": "Rewrote the README to match the project.",
  "3198f74": "Blockchain anchoring works on a local Hardhat chain, with an integrity check that compares the hash in the database with the one on the chain.",
  "611694b": "Added migration 012. The medicines were moved to a new prescription_items table, the payment columns that depended on the appointment were dropped, and we added the stored procedure, a trigger to keep prescriptions consistent and some new indexes.",
  "4fa0cdd": "Changed all database access to Prisma. Operations with more than one step now run inside transactions, the audit log saves who made each change, and we added /api/auth/me, the health profile API, server side pagination and one common error handler.",
  "0cc5722": "Frontend changes for the above: health profile form, allergy warning for doctors, page numbers on lists, admin search and filter, and the RoleGate check on every dashboard.",
  "6ff0fc6": "Small change to the admin dashboard header.",
  "f0ef5fa": "Wrote the database design document (ER diagram, schema, data dictionary and normalization) and the project proposal with the Gantt chart.",
  "ddd0827": "Added Dockerfiles, docker-compose, the GitHub Actions workflow, the backup and restore scripts and the Render config.",
  "2ac37ae": "Updated the README for these changes.",
  "7bfab2a": "Registering with an email that already exists now gives 409 instead of 400. We noticed this while testing for this report.",
  "18918c0": "Added a short overview document of the project.",
  "3959539": "The backend now listens on 0.0.0.0 so that Render can reach it, and the .vercel folder is ignored.",
  "6530d61": "On the deployed server there is no Ollama, so AI summaries failed. Added Claude (Anthropic API) as a hosted AI option (AI_PROVIDER=claude); Ollama is still used locally.",
  "925e4ec": "Claude is a paid API, so we added a free option: any OpenAI-compatible chat API, with Groq's free tier as the default (AI_PROVIDER=openai-compatible). This is what the live server uses. A wrong AI_PROVIDER now gives a clear error instead of quietly using Ollama.",
  "b0e7e8b": "Groq said the model we had set was not available for our key. Now, if a model is missing, the backend asks Groq which models the key can use and picks one, with openai/gpt-oss-120b as the default.",
};
const impRows = improvements.map((c) => `<tr><td class="mono">${c.short}</td><td>${esc(c.date)}</td><td>${esc(c.subject)}</td><td>${impText[c.short]}</td></tr>`).join("");

// ---------- sections (1-10 follow the question paper; also used for the contents page) ----------
const CH = [
  "Problem Statement", "Project Planning", "Database Design", "Database Implementation", "Application Development",
  "Authentication and Role-Based Authorization", "Database Security", "Database Backup and Recovery", "Version Control", "Deployment",
  "Bonus", "Project Execution", "Improvements", "Team Members' Commits", "Challenges Faced",
  "URLs, Tools and Resources", "Conclusion and Future Work",
];
const h1 = (n) => `<h1${n === 1 ? ' class="first"' : ""}>${CH[n - 1]}</h1>`;
const tocRows = (pages = {}) => [
  ...CH.map((t, i) => `<tr><td>${i + 1}.&nbsp;&nbsp;${t}</td><td>${pages[i + 1] ?? ""}</td></tr>`),
  `<tr><td>References</td><td>${pages.ref ?? ""}</td></tr>`,
].join("");

// ---------- document ----------
const page = (toc) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ELIXOR Project Report</title>
<style>
  @page { size: A4; margin: 25mm 22mm 22mm 28mm; }
  body { font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.5; color: #000; margin: 0; counter-reset: chapter; }
  p { margin: 0 0 8pt; text-align: justify; }
  h1 { font-size: 15pt; margin: 22pt 0 8pt; counter-increment: chapter; counter-reset: sec fig; break-after: avoid; }
  h1::before { content: counter(chapter) ".  "; }
  h1.first { break-before: page; margin-top: 0; }
  h1.plain { counter-increment: none; text-align: center; text-transform: uppercase; font-size: 16pt; margin: 0 0 14pt; break-before: page; }
  h1.plain::before { content: none; }
  h2 { font-size: 13pt; margin: 14pt 0 6pt; counter-increment: sec; break-after: avoid; }
  h2::before { content: counter(chapter) "." counter(sec) "  "; }
  h3 { font-size: 12pt; margin: 10pt 0 4pt; break-after: avoid; }
  ul, ol { margin: 0 0 8pt; padding-left: 22pt; } li { margin-bottom: 2pt; text-align: justify; }
  table { width: 100%; border-collapse: collapse; margin: 4pt 0 10pt; font-size: 11pt; line-height: 1.3; }
  th, td { border: 1px solid #000; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  th { font-weight: bold; }
  tr { break-inside: avoid; }
  figure { margin: 8pt 0 12pt; text-align: center; break-inside: avoid; }
  figcaption { font-size: 11pt; margin-top: 4pt; counter-increment: fig; font-weight: bold; }
  figcaption::before { content: "Fig. " counter(chapter) "." counter(fig) "  "; }
  .label { font-weight: bold; margin: 6pt 0 2pt; break-after: avoid; }
  pre { font-family: "Courier New", Courier, monospace; font-size: 8.5pt; line-height: 1.25; margin: 0 0 8pt; padding: 5pt 7pt; white-space: pre-wrap; break-inside: avoid; border: 1px solid #000; }
  code, .mono { font-family: "Courier New", Courier, monospace; font-size: 10.5pt; }
  .todo { border: 1px dashed #000; padding: 26pt 8pt; text-align: center; margin: 6pt 0 12pt; }
  .cover { text-align: center; height: 245mm; display: flex; flex-direction: column; line-height: 1.4; }
  .cover p { text-align: center; }
  .cover .title { font-size: 22pt; font-weight: bold; margin: 26pt 0 4pt; }
  .cover .big { font-size: 13pt; } .cover table { width: 80%; margin: 10pt auto; font-size: 12pt; }
  .toc td { border: none; padding: 3pt 0; font-size: 12pt; } .toc td:last-child { text-align: right; width: 12%; }
  .toc th { border: none; border-bottom: 1px solid #000; } .toc th:last-child { text-align: right; }
  .small { font-size: 10.5pt; }
  .commits td, .commits th { font-size: 9pt; padding: 2pt 4pt; }
  .sign { text-align: right; margin-top: 30pt; }
  ol.refs li { margin-bottom: 4pt; text-align: left; }
</style></head><body>

<div class="cover">
  <p style="font-size:14pt;margin-top:6pt"><b>VELLORE INSTITUTE OF TECHNOLOGY, VELLORE</b><br>School of Computer Science and Engineering</p>
  <p class="big" style="margin-top:20pt">A Project Report on</p>
  <p class="title">ELIXOR: A Healthcare Management System</p>
  <p class="big">submitted for the course<br><b>BCSE307L Database Systems</b><br>Fall Semester 2026-27 (Assessments 8, 9 and 10)</p>
  <p class="big" style="margin-top:16pt">Submitted by</p>
  <table>
    <tr><th style="width:10%">S.No</th><th>Name</th><th style="width:30%">Reg. No</th></tr>
    <tr><td>1</td><td>Sanidhya Srivastava</td><td>24BCB0135</td></tr>
    <tr><td>2</td><td>Arna Adhikari</td><td>24BDS0363</td></tr>
  </table>
  <p class="big" style="margin-top:10pt">Under the guidance of<br><b>Dr. Deepika J</b></p>
  <p class="big">Slot: L11+L12 &nbsp;&nbsp; Class No: VL2026270104071</p>
  <p class="big" style="margin-top:auto">Live: https://elixor-dun.vercel.app<br>GitHub: https://github.com/Zageraus/Elixo</p>
  <p class="big">[Month] 2026</p>
</div>

<h1 class="plain">Acknowledgement</h1>
<p>We would like to thank our faculty, Dr. Deepika J, for guiding us throughout this project. Her feedback during the first review helped us find mistakes in our database design and improve it, and we learned a lot in the process of fixing them.</p>
<p>We also thank the School of Computer Science and Engineering, Vellore Institute of Technology, for giving us the chance to do a full project as part of the Database Systems course. It helped us understand how the concepts taught in class are used in a real application.</p>
<p>Lastly, we thank our families and friends for their support while we were working on this project.</p>
<p class="sign">Sanidhya Srivastava (24BCB0135)<br>Arna Adhikari (24BDS0363)</p>

<h1 class="plain">Abstract</h1>
<p>ELIXOR is a healthcare management system made for small clinics. Using it, patients can book appointments with doctors, pay the consultation fee, save their health details like blood group and allergies, and view their prescriptions and medical reports online. Doctors can accept or decline appointments and write prescriptions. The admin can manage all the users and see statistics for the whole platform.</p>
<p>Since this is a Database Systems project, most of our work went into the database. We designed it in PostgreSQL with 13 tables, all normalized up to 3NF (and BCNF). Important rules are enforced by the database itself using primary and foreign keys, CHECK constraints, triggers, views and a stored procedure. The backend is written in Express.js and uses the Prisma ORM for all its queries, and whenever more than one table is changed, it is done inside a transaction. The frontend is made using Next.js. Along with this we implemented JWT based login, role based access for patients, doctors and admins, database backups using pg_dump, Docker images and a CI pipeline using GitHub Actions. The application is deployed, with the frontend on Vercel (https://elixor-dun.vercel.app) and the API on Render.</p>
<p><b>Keywords:</b> DBMS, PostgreSQL, Normalization, Prisma ORM, Transactions, Triggers, Healthcare</p>

<h1 class="plain">Contents</h1>
<table class="toc">
  <tr><th style="text-align:left">Section</th><th>Page</th></tr>
  ${toc}
</table>

${h1(1)}
<h2>Background</h2>
<p>In a lot of small clinics, appointments, prescriptions and patient records are still kept in paper registers, Excel sheets or WhatsApp chats. Because of this, some common problems come up:</p>
<ul>
  <li>Two patients get booked with the same doctor at the same time.</li>
  <li>Lab reports get lost or are hard to find later.</li>
  <li>A prescription can be changed afterwards and there is no record of who changed it.</li>
  <li>The clinic has no easy way to know how much a doctor has earned or how busy they are.</li>
  <li>Anyone who has the file can see all the patients' data.</li>
</ul>
<h2>Existing System</h2>
<p>Right now, small clinics mostly use manual records or general tools like spreadsheets. These have no relationships between the data, so the same patient's details are typed again and again in different places. There is also no validation, for example nothing stops someone from entering a negative fee or a medicine for zero days. There is no access control either, since anyone who opens the file can see or edit everything.</p>
<h2>Proposed System</h2>
<p>We propose ELIXOR, a web application built around a single relational database. Every patient, doctor, appointment, payment and prescription is stored once and linked to the others using foreign keys. Rules like "only one payment per appointment" or "a medicine has to be given for at least one day" are written as constraints, so the database will reject wrong data even if there is a bug in our code. Each user has to log in and can only see what their role allows.</p>
<p>We chose healthcare as our domain because the data has clear relationships (patients, doctors, visits, prescriptions, payments), and because correctness and privacy of data are very important in this field. This made it a good fit for the topics we studied in the course.</p>
<p>Fig. 1.1 shows the landing page of our application, which is also where users log in or create an account.</p>
${fig("app_01_login.jpg", "Landing and login page of ELIXOR")}

${h1(2)}
<h2>Project Title</h2>
<p>ELIXOR: A Healthcare Management System with a Normalized Relational Database, Role Based Access and Tamper Evident Medical Records.</p>
<h2>Problem Statement</h2>
<p>Small clinics keep appointments, prescriptions, payments and reports in registers and spreadsheets, which leads to double bookings, lost reports, untracked changes and no access control (Section 1). We need a relational database, with a web application on top of it, that stores this data once, enforces the clinic's rules, and lets each user see only what their role allows.</p>
<h2>Objectives</h2>
<ol>
  <li>To design an ER model and convert it into a relational schema in 3NF, with at least 4 main entities, 3 relationships and 8 tables.</li>
  <li>To implement the schema in PostgreSQL with proper keys, constraints and indexes.</li>
  <li>To use joins, aggregate queries, views, transactions, a stored procedure and triggers inside the actual application.</li>
  <li>To access the database from the backend through an ORM (Prisma).</li>
  <li>To build a responsive web app with login, dashboards, CRUD, search, filtering, pagination, validation and error handling.</li>
  <li>To secure the system using JWT login, role based access with a single users table, hashed passwords and secrets kept out of the code.</li>
  <li>To use GitHub for version control and to set up backups, Docker and deployment.</li>
</ol>
<h2>Scope</h2>
<p><b>In scope:</b> patient, doctor and admin accounts; booking and approving appointments; fee payment (simulated) with refund on cancellation; prescriptions with more than one medicine; uploading medical reports with an AI generated summary; notifications; admin statistics and user management; an audit log; and optionally saving the hash of reports and prescriptions on a blockchain so that any tampering can be detected.</p>
<p><b>Out of scope:</b> a real payment gateway (payments are only simulated and we never ask for card details), giving medical advice, and hospital features like wards, pharmacy stock or insurance.</p>
<h2>Team Members and Responsibilities</h2>
<table>
  <tr><th style="width:22%">Name</th><th style="width:14%">Reg. No</th><th style="width:16%">Module</th><th>Responsibilities</th></tr>
  <tr><td>Sanidhya Srivastava</td><td>24BCB0135</td><td>Database</td><td>ER diagram, relational schema and normalization; SQL migrations with keys, constraints, indexes, triggers, views, the stored procedure and row level security; seed data; Prisma ORM and transactions in the backend; backup and restore scripts</td></tr>
  <tr><td>Arna Adhikari</td><td>24BDS0363</td><td>AI and Blockchain</td><td>AI summaries of medical reports; the MedicalAudit smart contract (Solidity, Hardhat); anchoring report and prescription hashes on the blockchain and checking them later for tampering (healthchain-upgrade branch, PR #1); running the AI summaries on Groq's free API for the deployed server</td></tr>
</table>
<p>We divided the project into these two modules so that each of us could work on one part at a time. The web application (API, dashboards and login) was built on top of both modules.</p>
<h2>Technology Stack</h2>
<table>
  <tr><th style="width:24%">Layer</th><th>Technology</th></tr>
  <tr><td>Frontend</td><td>Next.js 14 (React 18, TypeScript), Tailwind CSS</td></tr>
  <tr><td>Backend</td><td>Node.js, Express.js 4, TypeScript, Zod for validation</td></tr>
  <tr><td>ORM</td><td>Prisma 6</td></tr>
  <tr><td>Database</td><td>PostgreSQL 17, hosted on Supabase</td></tr>
  <tr><td>Authentication</td><td>JWT; passwords handled by Supabase Auth (bcrypt)</td></tr>
  <tr><td>AI</td><td>Groq's free API (model openai/gpt-oss-120b) on the deployed server; Ollama (local model) when running on a laptop</td></tr>
  <tr><td>Other</td><td>Hardhat and Solidity (blockchain), Docker, GitHub Actions</td></tr>
  <tr><td>Hosting</td><td>Vercel for the frontend, Render for the API</td></tr>
</table>
<p>To run the project, a computer needs Node.js 20 and npm, Git and a web browser. Any recent dual core processor with 8 GB RAM is enough (more helps if the local AI model is used). Docker, the PostgreSQL 17 client tools (for backup and restore) and Ollama (for local AI summaries) are optional.</p>
<h2>Major Deliverables</h2>
<ul>
  <li>ER diagram, relational schema and data dictionary</li>
  <li>SQL migration files (001 to 012) and seed data</li>
  <li>Backend API and frontend web application</li>
  <li>Smart contract with tests</li>
  <li>Backup and restore scripts, Dockerfiles and CI workflow</li>
  <li>README and this report</li>
</ul>
<h2>Project Timeline</h2>
<p>We planned the work in phases as shown in the Gantt chart below. The red line marks 29 October 2026.</p>
${fig("ev_gantt_chart.jpg", "Gantt chart of the project")}

${h1(3)}
<h2>Identification of Entities</h2>
<p>The five main entities in our system are <b>User</b>, <b>Appointment</b>, <b>Medical Report</b>, <b>Prescription</b> and <b>Payment</b>. Patients, doctors and admins are all stored as users, and their role decides what they are allowed to do. Some details only apply to one role, like a doctor's licence number and fee or a patient's blood group and allergies. We kept these in separate one-to-one profile tables, otherwise the users table would have many columns that are empty for most rows.</p>
<p>The supporting entities are the two profile tables, Prescription Item (a weak entity, one row for each medicine), AI Analysis, Blockchain Transaction, Notification, Audit Log and Auth Nonce (used for wallet login).</p>
<h2>Relationships</h2>
<table>
  <tr><th>Relationship</th><th style="width:22%">Cardinality</th></tr>
  <tr><td>A patient books appointments</td><td>1 : N</td></tr>
  <tr><td>A doctor attends appointments</td><td>1 : N</td></tr>
  <tr><td>An appointment is paid by a payment</td><td>1 : 0..1</td></tr>
  <tr><td>A doctor issues prescriptions to a patient</td><td>1 : N</td></tr>
  <tr><td>An appointment can result in prescriptions</td><td>1 : N (optional)</td></tr>
  <tr><td>A prescription contains medicines (prescription items)</td><td>1 : N (identifying)</td></tr>
  <tr><td>A patient has medical reports; a doctor can review them</td><td>1 : N</td></tr>
  <tr><td>A report is analysed by the AI</td><td>1 : N</td></tr>
  <tr><td>A report or prescription is anchored by blockchain transactions</td><td>1 : N</td></tr>
  <tr><td>A user has a doctor or patient profile</td><td>1 : 0..1</td></tr>
  <tr><td>A user receives notifications and appears in the audit log</td><td>1 : N</td></tr>
</table>
<h2>ER Diagram</h2>
<p>The ER diagram of our database is shown in Fig. 3.1. We have used crow's foot notation.</p>
${fig("ev_er_diagram.jpg", "ER diagram of ELIXOR")}
<h2>Relational Schema</h2>
<p>To convert the ER diagram into tables, each entity became a table and each 1:N relationship became a foreign key on the "many" side. The 1:1 profile tables use the user's id as their primary key, and the weak entity Prescription Item uses the prescription's key along with a line number. In the schema below, primary keys are underlined and foreign keys are marked with *.</p>
<pre class="out">users (<u>id</u>, wallet_address, role, full_name, email, phone, is_active, created_at, updated_at)
doctor_profiles (<u>user_id*</u>, specialization, license_number, years_experience, consultation_fee, bio)
patient_profiles (<u>user_id*</u>, date_of_birth, blood_group, allergies, emergency_contact)
appointments (<u>id</u>, patient_id*, doctor_id*, scheduled_at, status, reason, notes, created_at, updated_at)
payments (<u>id</u>, appointment_id*, amount, currency, method, provider, provider_ref, status, paid_at, refunded_at)
prescriptions (<u>id</u>, appointment_id*, patient_id*, doctor_id*, notes, issued_at)
prescription_items (<u>id</u>, prescription_id*, line_no, medicine_name, dosage, frequency, duration_days)
medical_reports (<u>id</u>, patient_id*, doctor_id*, appointment_id*, report_type, title, file_url, file_hash, raw_text, created_at)
ai_analyses (<u>id</u>, report_id*, summary, findings, embedding, model_used, confidence, created_at)
blockchain_transactions (<u>id</u>, report_id*, prescription_id*, chain, tx_hash, block_number, data_hash, status, gas_used, created_at, confirmed_at)
notifications (<u>id</u>, user_id*, type, message, is_read, created_at)
audit_logs (<u>id</u>, user_id*, action, entity_type, entity_id, metadata, created_at)
auth_nonces (<u>id</u>, wallet_address, nonce, expires_at, consumed_at, created_at)</pre>
<h2>Data Dictionary</h2>
<p>The data dictionary for the main tables is given below. The complete dictionary for all 13 tables is in <code>docs/DATABASE_DESIGN.md</code> in our repository.</p>
<table>
  <tr><th colspan="3">users</th></tr><tr><th style="width:24%">Column</th><th style="width:18%">Type</th><th>Constraints / description</th></tr>
  <tr><td>id</td><td>uuid</td><td>Primary key, generated automatically</td></tr>
  <tr><td>role</td><td>user_role (enum)</td><td>NOT NULL, default 'patient'; one of patient, doctor, admin</td></tr>
  <tr><td>full_name</td><td>text</td><td>NOT NULL</td></tr>
  <tr><td>email</td><td>citext</td><td>UNIQUE, case-insensitive</td></tr>
  <tr><td>wallet_address</td><td>citext</td><td>UNIQUE, CHECK on the address format</td></tr>
  <tr><td>is_active</td><td>boolean</td><td>NOT NULL, default true; false when an admin deactivates the user</td></tr>
  <tr><td>created_at, updated_at</td><td>timestamptz</td><td>NOT NULL, default now(); updated_at kept current by a trigger</td></tr>
</table>
<table>
  <tr><th colspan="3">appointments</th></tr><tr><th style="width:24%">Column</th><th style="width:18%">Type</th><th>Constraints / description</th></tr>
  <tr><td>id</td><td>uuid</td><td>Primary key</td></tr>
  <tr><td>patient_id, doctor_id</td><td>uuid</td><td>NOT NULL, foreign keys to users (ON DELETE CASCADE); CHECK patient_id &lt;&gt; doctor_id</td></tr>
  <tr><td>scheduled_at</td><td>timestamptz</td><td>NOT NULL</td></tr>
  <tr><td>status</td><td>appointment_status (enum)</td><td>NOT NULL, default 'requested'</td></tr>
  <tr><td>reason, notes</td><td>text</td><td>Optional</td></tr>
</table>
<table>
  <tr><th colspan="3">payments</th></tr><tr><th style="width:24%">Column</th><th style="width:18%">Type</th><th>Constraints / description</th></tr>
  <tr><td>appointment_id</td><td>uuid</td><td>NOT NULL, UNIQUE (one payment per visit), foreign key to appointments</td></tr>
  <tr><td>amount</td><td>numeric(10,2)</td><td>NOT NULL, CHECK amount &gt; 0; the fee at the time of payment</td></tr>
  <tr><td>method, status</td><td>enums</td><td>NOT NULL; status defaults to 'paid'</td></tr>
  <tr><td>provider_ref</td><td>text</td><td>NOT NULL, UNIQUE receipt number</td></tr>
  <tr><td>refunded_at</td><td>timestamptz</td><td>CHECK: set only when status is 'refunded'</td></tr>
</table>
<table>
  <tr><th colspan="3">prescription_items</th></tr><tr><th style="width:24%">Column</th><th style="width:18%">Type</th><th>Constraints / description</th></tr>
  <tr><td>prescription_id</td><td>uuid</td><td>NOT NULL, foreign key to prescriptions (ON DELETE CASCADE)</td></tr>
  <tr><td>line_no</td><td>smallint</td><td>NOT NULL, CHECK &gt; 0, UNIQUE together with prescription_id</td></tr>
  <tr><td>medicine_name</td><td>text</td><td>NOT NULL, CHECK not blank</td></tr>
  <tr><td>dosage, frequency</td><td>text</td><td>NOT NULL</td></tr>
  <tr><td>duration_days</td><td>integer</td><td>NOT NULL, CHECK &gt; 0</td></tr>
</table>
<h2>Constraints</h2>
<p>Other than primary and foreign keys, we have used NOT NULL on required columns, UNIQUE wherever duplicates should not be allowed, CHECK constraints for rules on values, and DEFAULT values for ids, timestamps and statuses. We ran the following query on our database to list all the CHECK and UNIQUE constraints:</p>
${query("constraints")}
<h2>Normalization</h2>
<p>Every table has a single column primary key, so there were no partial dependencies and 2NF was not a problem. However, when we reviewed our first design we found two problems, which we fixed in migration 012:</p>
<ol>
  <li><b>1NF:</b> The prescriptions table stored all the medicines as a JSON array in one column. This is a repeating group, so it violates 1NF. We created a new table <code>prescription_items</code> which has one row for each medicine.</li>
  <li><b>3NF:</b> The payments table had <code>patient_id</code> and <code>doctor_id</code> columns. But every payment belongs to exactly one appointment, and the appointment already decides the patient and doctor (payment → appointment → patient). This is a transitive dependency, so we removed these two columns.</li>
</ol>
<p>After these changes, the only determinants in each table are candidate keys (for example id, email, licence number, receipt number, or prescription_id + line_no). So the tables are also in BCNF. One thing we kept on purpose is that <code>prescriptions</code> still stores the patient and doctor, because a prescription does not always have an appointment. When an appointment is linked, a trigger checks that the patient and doctor match.</p>
<p>The output below shows the new prescription_items table, and the columns of payments after the change:</p>
${query("prescription_items")}
${query("payments_cols")}
<h2>Indexes</h2>
<p>We created indexes on all foreign keys and on the columns that we filter or sort on (status, dates, role). The admin user search uses ILIKE '%text%', and a normal B-tree index does not help with that, so we added trigram (pg_trgm) GIN indexes on name and email.</p>
${query("indexes", 24)}

${h1(4)}
<h2>Creating the Database</h2>
<p>We used PostgreSQL 17 hosted on Supabase. The schema is created using SQL migration files that are kept in the repository, from <code>db/migrations/001_core_schema.sql</code> to <code>012_normalize_and_procedures.sql</code>. To set up a new database, <code>db/ALL_IN_ONE_SETUP.sql</code> runs all of them and then loads the seed data. In total the database has 13 tables, 13 primary keys and 17 foreign keys. The number of rows in each table at the time of writing is:</p>
<table>
  <tr><th>Table</th><th>Rows</th><th>Table</th><th>Rows</th></tr>
  <tr><td>users</td><td>21</td><td>medical_reports</td><td>11</td></tr>
  <tr><td>doctor_profiles</td><td>10</td><td>ai_analyses</td><td>9</td></tr>
  <tr><td>patient_profiles</td><td>9</td><td>blockchain_transactions</td><td>21</td></tr>
  <tr><td>appointments</td><td>32</td><td>notifications</td><td>66</td></tr>
  <tr><td>payments</td><td>11</td><td>audit_logs</td><td>128</td></tr>
  <tr><td>prescriptions</td><td>10</td><td>auth_nonces</td><td>0</td></tr>
  <tr><td>prescription_items</td><td>14</td><td></td><td></td></tr>
</table>
${todo("Supabase dashboard, Table Editor showing the tables in the public schema")}
${fig("gh_07_migration012.jpg", "Migration 012 in our repository")}
<h2>CRUD Operations</h2>
<p>To show all four operations, we created a test patient using the API, read it back, updated it, deactivated it and then deleted it. This account was made only for testing.</p>
<h3>Create</h3>${apiCall(1)}
<h3>Read</h3>${apiCall(3)}
<h3>Update</h3>${apiCall(4)}${apiCall(7)}
<h3>Delete</h3>${apiCall(9)}${apiCall(10)}
<p>The other tables work the same way through their own endpoints, for example creating and updating appointments, creating prescriptions, uploading reports and marking notifications as read.</p>
<h2>Joins</h2>
<p>The query below lists the recent appointments along with the patient's name, the doctor's name, the doctor's specialization and whether the visit is paid. The users table is joined twice here, once for the patient and once for the doctor.</p>
${query("join_appointments")}
<h2>Aggregate Queries</h2>
<p>This query finds the number of appointments, completed visits and total revenue for each doctor. It uses GROUP BY, HAVING and aggregates with FILTER:</p>
${query("aggregate_revenue")}
<h2>Views</h2>
<p>We created five views. <code>v_patient_dashboard</code> and <code>v_doctor_dashboard</code> are used for the appointment lists, <code>v_report_with_analysis</code> joins each report with its latest AI summary, <code>v_admin_analytics</code> calculates the numbers shown on the admin dashboard, and <code>v_doctor_weekly_load</code> counts the appointments of each doctor per week.</p>
${query("views_list")}
${query("view_load")}
<h2>Transactions</h2>
<p>Any operation that changes more than one row is run inside a transaction (<code>prisma.$transaction</code>), so either the whole thing succeeds or nothing changes. We used transactions for registering a doctor (user and profile), making a payment, issuing a prescription, deactivating or deleting a user, and changing the status of an appointment. In the payment transaction we also lock the appointment row using SELECT ... FOR UPDATE, so if two payment requests come at the same time, only one of them can go through.</p>
<p>The example below shows a rollback. One of the medicines has a duration of 0 days, which fails a CHECK constraint, so the whole prescription is rolled back, including the prescription row that had already been inserted.</p>
${demo("demo_atomicity")}
<p>Fig. 4.2 shows our payment route, where the whole checkout runs in one transaction along with the row lock.</p>
${fig("gh_10_payments_route.jpg", "Payment route using a transaction and a row lock")}
<h2>Stored Procedure</h2>
<p><code>sp_create_prescription</code> takes the doctor, the patient, an optional appointment, notes and the list of medicines in JSON format. It checks the input, inserts the prescription and one row for each medicine, and returns the id of the new prescription through an INOUT parameter. The backend calls this procedure whenever a doctor issues a prescription. We tested it inside a transaction and rolled it back after:</p>
${demo("demo_procedure")}
${query("procedures")}
<h2>Triggers</h2>
<p>There are 13 triggers in our database. They keep <code>updated_at</code> up to date, write every change on the main tables into <code>audit_logs</code>, send notifications, check that the doctor and patient of an appointment have the correct roles, refund the payment when an appointment is cancelled, and keep prescriptions consistent with their appointment.</p>
${query("triggers")}
<p>Below we tested the refund trigger. A paid appointment is cancelled and the payment status changes to refunded on its own. The audit log also shows which user made the change. This was also rolled back after the test.</p>
${demo("demo_trigger")}
<h2>ORM (Prisma)</h2>
<p>Our backend connects to the database through Prisma. Each table has a model in <code>backend/prisma/schema.prisma</code>. We used raw SQL only where Prisma does not directly support something (reading views, calling the stored procedure and the row lock), and even there we used Prisma's <code>$queryRaw</code>, which uses parameters.</p>
${fig("gh_08_schema_prisma.jpg", "Part of our Prisma schema")}
${fig("gh_09_prisma_ts.jpg", "Prisma client setup and the transaction helper")}
${todo("Supabase SQL Editor running a query, for example select * from v_admin_analytics")}

${h1(5)}
<p>The frontend of ELIXOR is a Next.js application and the backend is a REST API made with Express.js. There are three types of users and each one has a separate dashboard. In this section we show the main screens of the application.</p>
<h2>Login and Registration</h2>
<p>Fig. 5.1 shows the registration form. If the user enters a password that is too short, a validation message is shown and the form is not submitted.</p>
${fig("app_02_register_validation.jpg", "Registration form with a validation message", 62)}
<h2>Dashboards</h2>
<p>The patient dashboard shows upcoming appointments, prescriptions, reports and payments. The doctor dashboard shows the appointment queue and the prescription form, and the admin dashboard shows the statistics and user management.</p>
${fig("app_10_patient_top.jpg", "Patient dashboard")}
${fig("app_20_doctor_top.jpg", "Doctor dashboard")}
${fig("app_30_admin_top.jpg", "Admin dashboard")}
<h2>CRUD from the Interface</h2>
${fig("app_18_profile_saved.jpg", "Patient saving their health profile")}
${fig("app_21_doctor_queue.jpg", "Doctor's appointment queue with accept, decline and complete options")}
${fig("app_36_delete_confirm.jpg", "Admin deleting a user after confirmation", 55)}
<h2>Search</h2>
<p>The admin can search users by name or email. The search is done on the server, so it works on all the users and not only the ones on the current page.</p>
${fig("app_34_users_search.jpg", "Searching users by name or email")}
<h2>Filtering</h2>
${fig("app_35_doctors_active_filter.jpg", "Doctors filtered to show only active accounts")}
${fig("app_12_booking_filter.jpg", "Patient filtering doctors by specialization")}
<h2>Pagination</h2>
${fig("app_32_users_page1.jpg", "User list, page 1")}
${fig("app_33_users_page2.jpg", "User list, page 2")}
<h2>Form Validation</h2>
<p>Forms are checked in the browser and then again on the server using Zod. So even if someone calls the API directly, invalid data will be rejected. Example:</p>
${apiCall(11)}
<h2>Exception Handling</h2>
<p>All errors on the server go through one error handler, which returns a proper message and status code instead of crashing. It returns 400 for invalid input, 401 if the user is not logged in, 403 for the wrong role, 404 when something does not exist, 409 for duplicates and 503 if the database cannot be reached. Some examples:</p>
${apiCall(12)}${apiCall(14)}${apiCall(15)}
<h2>Responsive Design</h2>
<p>The application also works on mobile screens. Fig. 5.13 shows the patient dashboard on a phone sized screen.</p>
${fig("app_19_patient_mobile.jpg", "Patient dashboard on a phone sized screen", 34)}

${h1(6)}
<h2>Authentication</h2>
<p>We have used JWT for authentication. When a user logs in with their email and password, the password is checked by Supabase Auth and our backend gives back a signed token that expires after 12 hours. The token is sent with every request in the Authorization header. For every request, the server checks the token and also checks in the database that the account is still active. So if the admin deactivates someone, they get logged out immediately. Logging out deletes the token from the browser.</p>
${apiCall(2)}
<p>The details of the logged in user can be fetched from <code>GET /api/auth/me</code> (shown in the CRUD section). After the account is deactivated, the same token does not work any more:</p>
${apiCall(8)}
<h2>Role Based Access</h2>
<p>There are three roles: patient, doctor and admin. All the users are stored in one <code>users</code> table and the <code>role</code> column decides what they can do. We did not make a separate table for each role.</p>
${query("users_roles")}
<p>Access is restricted at three levels:</p>
<ul>
  <li><b>Menus:</b> every role only sees its own dashboard and the actions related to it.</li>
  <li><b>Pages:</b> before showing a dashboard, the frontend asks the server who the user is. If the role does not match, the user is sent to their own dashboard. To test this, we logged in as a patient and changed the role saved in the browser to "admin". The admin page still redirected us back to the patient page.</li>
  <li><b>API:</b> protected routes check the role and return 403 if it is wrong. Queries are also limited to the user's own data.</li>
</ul>
${fig("app_41_rolegate_redirected.jpg", "Patient trying to open /admin is sent back to the patient dashboard")}
${apiCall(13)}

${h1(7)}
<p>We took the following steps to keep the database secure:</p>
<ul>
  <li><b>Password hashing:</b> passwords are stored by Supabase Auth as bcrypt hashes. Our own tables do not store any passwords.</li>
  <li><b>SQL injection:</b> all queries go through Prisma, which sends values as parameters. Where we wrote SQL ourselves, we used Prisma's tagged templates which also use parameters. So user input is never directly added into an SQL string.</li>
  <li><b>Secrets:</b> the database URL, JWT secret and API keys are kept in <code>backend/.env</code> and loaded using dotenv. The .env files are in .gitignore and are not pushed to GitHub. Only an example file with dummy values is in the repository.</li>
  <li><b>Row level security:</b> as an extra layer, RLS is turned on for every table, with policies that only allow users to access their own rows.</li>
</ul>
${fig("gh_11_gitignore.jpg", "Our .gitignore file, which excludes environment files and backups")}
${query("rls", 20)}

${h1(8)}
<p>For backups we wrote two scripts that use PostgreSQL's own tools. <code>scripts/db-backup.sh</code> runs pg_dump in custom format and saves a file such as <code>backups/elixor_20261030_1015.dump</code>. <code>scripts/db-restore.sh</code> restores this file using pg_restore. The restore runs as a single transaction, so if it fails in the middle, nothing is half restored. The backups folder is added to .gitignore because it has real data.</p>
<p>Commands used:</p>
<pre class="code">bash scripts/db-backup.sh
pg_restore --list backups/elixor_&lt;timestamp&gt;.dump
RESTORE_URL=&lt;test database&gt; bash scripts/db-restore.sh backups/elixor_&lt;timestamp&gt;.dump</pre>
${todo("terminal output of the backup script")}
${todo("terminal output of the restore into a test database")}

${h1(9)}
<p>Our final project is on GitHub at https://github.com/Zageraus/Elixo and the repository is public. We use two branches, <code>main</code> and <code>dev</code>. New work is done on dev and then merged into main through a pull request (PR #1 "Dev", merged on 28 October 2026). The README explains what the project is, the tech stack, and how to install and run it. The .gitignore file keeps secrets and build files out of the repository.</p>
<h2>Repositories Used During the Project</h2>
<p>The project moved through a few repositories before we settled on the final one. Each later repository carries the history of the one before it, so all the commits can still be seen in the final repository.</p>
<table>
  <tr><th style="width:38%">Repository</th><th style="width:14%">Created</th><th>What it was used for</th></tr>
  <tr><td>https://github.com/Zageraus/Healthcare</td><td>22 Sep 2026</td><td>First repository, created when we picked the topic. No code was pushed to it.</td></tr>
  <tr><td>https://github.com/Arnahhh/HealthChain-Finalised</td><td>16 Oct 2026</td><td>Arna's upload of the whole project, including the AI service and smart contract (1 commit).</td></tr>
  <tr><td>https://github.com/Arnahhh/HealthChain-AI-and-BlockChain-integrated-</td><td>19 Oct 2026</td><td>The project after the AI and blockchain upgrade was merged (PR #1, healthchain-upgrade). 10 commits.</td></tr>
  <tr><td>https://github.com/Arnahhh/Elixor-update</td><td>20 Oct 2026</td><td>The project after it was renamed to ELIXOR. 12 commits.</td></tr>
  <tr><td>https://github.com/Zageraus/Elixo</td><td>25 Oct 2026</td><td>Final repository with the database work, improvements and deployment. Contains the full history (${commits.length - 1} commits).</td></tr>
</table>
${fig("gh_01_repo.jpg", "Our GitHub repository")}
${fig("gh_02_branches.jpg", "Branches main and dev")}
${fig("gh_03_commits_main.jpg", "Commit history")}

${h1(10)}
<p>The application is deployed and can be used online. The three parts are hosted separately:</p>
<table>
  <tr><th style="width:22%">Part</th><th style="width:20%">Hosted on</th><th>URL</th></tr>
  <tr><td>Frontend (Next.js)</td><td>Vercel</td><td>https://elixor-dun.vercel.app</td></tr>
  <tr><td>Backend API (Express.js)</td><td>Render</td><td>https://elixor-backend.onrender.com</td></tr>
  <tr><td>Database (PostgreSQL 17)</td><td>Supabase</td><td>Managed, not public</td></tr>
</table>
<p>The frontend gets the address of the API from the environment variable <code>NEXT_PUBLIC_API_URL</code>, which we set in Vercel. On the backend, the database URL, JWT secret and other keys are set as environment variables in Render, so they are not in the code. The backend only accepts requests from our Vercel domain (CORS). Our CI pipeline also builds the Docker images of both parts on every push, and <code>render.yaml</code> and the Dockerfiles are in the repository.</p>
<p>Two features needed a different setup on the live server than on our laptops:</p>
<ul>
  <li><b>AI summaries:</b> locally the backend uses an Ollama model, but Render has no Ollama. So on Render we set <code>AI_PROVIDER=openai-compatible</code> and a free Groq API key (<code>AI_API_KEY</code>), and the summaries are written by a model on Groq's free API (<code>openai/gpt-oss-120b</code> by default). The backend asks for the answer in JSON and checks it before saving it to <code>ai_analyses</code>. If the model is not available for our key, the backend asks Groq for the list of models and picks another one.</li>
  <li><b>Blockchain anchoring:</b> anchoring needs a running blockchain node, which we only run locally (Hardhat). On Render we set <code>BLOCKCHAIN_ENABLED=false</code>, so the live site skips anchoring and says so in the upload message. Anchoring and the integrity check work when the project is run locally with the Hardhat chain.</li>
</ul>
<p><b>Live URL:</b> https://elixor-dun.vercel.app</p>
${fig("live_01_landing.jpg", "ELIXOR running live at https://elixor-dun.vercel.app")}
<p>To check that the deployed backend is running and connected to the database, we called its health endpoint:</p>
<p class="label">Request:</p><pre class="code">GET https://elixor-backend.onrender.com/health</pre>
<p class="label">Response:</p><pre class="out">Status: 200
{
  "status": "ok",
  "service": "healthchain-backend",
  "database": "ok"
}</pre>
<p>We also checked that the API allows requests from the frontend's domain. A CORS preflight request from https://elixor-dun.vercel.app returned <code>204 No Content</code> with <code>Access-Control-Allow-Origin: https://elixor-dun.vercel.app</code>.</p>

${h1(11)}
<h2>CI/CD using GitHub Actions</h2>
<p>Whenever we push to main or dev, our workflow runs automatically. It validates the Prisma schema, type checks and builds the backend and frontend, runs the smart contract tests and builds the Docker images.</p>
${fig("gh_06_ci_run.jpg", "A successful CI run")}
${fig("gh_05_actions.jpg", "List of CI runs")}
<h2>Other Practices</h2>
<p>We used a managed cloud database (Supabase), an audit log that is filled automatically by triggers and also stores which user made the change, automated tests in CI, and indexes based on the queries our app actually runs. The query below shows the latest entries in the audit log:</p>
${query("audit")}

${h1(12)}
<p>In this section we follow one patient visit through the whole system. For every step we have written the input, what happens in the system (processing), and the output.</p>
<h2>Patient Books an Appointment</h2>
<p><b>Input:</b> the patient selects a specialization, a doctor, a date and a reason.<br><b>Processing:</b> the API checks the token and role, validates the data and inserts the appointment inside a transaction. A trigger notifies the doctor and writes an audit record.<br><b>Output:</b> the appointment is shown with status "requested".</p>
${fig("app_12_booking_filter.jpg", "Booking form")}
<h2>Doctor Sees the Request</h2>
<p><b>Input:</b> the doctor opens their dashboard.<br><b>Processing:</b> the API reads the doctor's appointments from the <code>v_doctor_dashboard</code> view and adds the payment status and the patient's allergies.<br><b>Output:</b> the appointment queue, with the patient's allergies highlighted.</p>
${fig("app_21_doctor_queue.jpg", "Doctor's appointment queue")}
<h2>Doctor Writes a Prescription</h2>
<p><b>Input:</b> patient, medicines and notes.<br><b>Processing:</b> the API calls the stored procedure inside a transaction. Triggers check consistency, write the audit log and notify the patient.<br><b>Output:</b> the prescription is saved and shown to both the doctor and the patient.</p>
${fig("app_22_prescription_form.jpg", "Prescription form with the allergy warning")}
<h2>Patient Views the Prescription and Pays</h2>
<p><b>Input:</b> payment method.<br><b>Processing:</b> the payment transaction locks the appointment, checks that it is confirmed and not already paid, and saves the payment using the doctor's fee from the database.<br><b>Output:</b> a receipt is generated and the appointment is shown as paid.</p>
${fig("app_14_patient_prescriptions.jpg", "Patient's prescriptions")}
${fig("app_17_checkout.jpg", "Checkout page (simulated, no real payment)", 52)}
<h2>Patient Uploads a Report</h2>
<p><b>Input:</b> title, type, file and optionally the text of the report.<br><b>Processing:</b> the file is stored privately, its SHA-256 hash is saved, and the text is summarised by the AI model (Groq's free API on the live server, Ollama when we run it locally).<br><b>Output:</b> the report is shown along with its AI summary.</p>
${fig("app_15_patient_reports.jpg", "Reports with AI summaries")}
<h2>Admin Checks the Platform</h2>
<p><b>Input:</b> the admin opens the dashboard.<br><b>Processing:</b> the API reads from <code>v_admin_analytics</code> and <code>v_doctor_weekly_load</code>.<br><b>Output:</b> totals, revenue, refunds and a weekly load chart, along with user management.</p>
${query("view_admin")}

${h1(13)}
<p>At our first review, the project only had the login page and appointment booking. This was the state of the code up to commit a966cbe ("Add email auth, appointment booking, and optional blockchain anchoring", 25 October 2026). Everything listed below was added after the review. Any commit can be opened at https://github.com/Zageraus/Elixo/commit/&lt;ID&gt;.</p>
<table>
  <tr><th style="width:10%">Commit ID</th><th style="width:14%">Date</th><th style="width:27%">Commit message</th><th>What we changed</th></tr>
  ${impRows}
</table>
<p>Compared to the version we showed in the first review, the main changes are:</p>
<ul>
  <li>Doctors can now accept, decline and complete appointments, and patients can filter doctors by specialization.</li>
  <li>Consultation payments were added, with an automatic refund (trigger) when a paid appointment is cancelled.</li>
  <li>Doctors can write prescriptions, and patients can save a health profile with their allergies, which doctors see as a warning.</li>
  <li>Patients can upload medical reports and get an AI summary of them, and reports and prescriptions can be anchored on the blockchain and checked for tampering.</li>
  <li>The admin can search, filter, page through, deactivate and delete users, and patients are notified when their doctor is removed.</li>
  <li>The schema was normalized further (new prescription_items table, payment columns removed) and we added a stored procedure.</li>
  <li>All database access was moved to the Prisma ORM, and operations with many steps now run inside transactions.</li>
  <li>Every dashboard checks the user's role with the server before it is shown.</li>
  <li>We added the design documents, Docker setup, CI pipeline and backup scripts, and deployed the app on Vercel and Render.</li>
</ul>
${fig("gh_04_commits_dev.jpg", "Commits on the dev branch after the review")}

${h1(14)}
<p>The work was divided into two modules: the database, done by Sanidhya, and the AI and blockchain part, done by Arna. The commits of each member from all our repositories are listed below. The "Repository" column gives the first repository the commit was pushed to (see Section 9.1), and the "Area" column tells which part of the system the commit changes.</p>
<p>Some of Arna's AI and blockchain work (commits ${ARNA_VIA_ZAGERAUS.join(", ")}) was pushed to GitHub from Sanidhya's account, so GitHub shows Zageraus as the author of these commits. They are listed under Arna below, and the "Pushed from" column shows which GitHub account pushed each commit. "Arna*" means the commit was made from a computer where git was set up with a placeholder email (commits f4548fd and d534716), so GitHub does not link it to an account; the author name on both commits is "Arna".</p>
<table>
  <tr><th>Member</th><th>Reg. No</th><th>GitHub ID</th><th>Module</th><th>Commits</th></tr>
  ${[SANIDHYA, ARNA].map((m) => `<tr><td>${m.name}</td><td>${m.reg}</td><td>${m.gh}</td><td>${m.module}</td><td>${memberCommits(m).length}</td></tr>`).join("")}
</table>
<h2>Sanidhya Srivastava: Database</h2>
${memberTable(SANIDHYA)}
<h2>Arna Adhikari: AI and Blockchain</h2>
${memberTable(ARNA)}

${h1(15)}
<p>Some of the problems we ran into while doing this project, and how we solved them:</p>
<ol>
  <li><b>Normalization mistakes in our first design.</b> We had stored the medicines of a prescription as a JSON list, and the payments table had patient and doctor columns. After the first review we understood that these break 1NF and 3NF. Fixing them meant writing a migration that moved the old data into the new prescription_items table without losing anything, and then updating the backend and frontend to use the new table.</li>
  <li><b>Moving to an ORM.</b> We started with the Supabase query builder. Changing every query to Prisma took a lot of time, and Prisma cannot read views or call procedures directly, so for those we had to use <code>$queryRaw</code>.</li>
  <li><b>Keeping data consistent.</b> Earlier, when one step of an operation failed (for example creating a doctor's profile after creating the user), we had to delete the half created data ourselves. Using transactions solved this, but we had to restructure the code so that all the steps run inside one transaction.</li>
  <li><b>Database connection timeouts.</b> The Supabase connection sometimes timed out on slow internet. We fixed this by increasing the connect and pool timeouts in the database URL.</li>
  <li><b>Recording who made a change.</b> Triggers run inside the database, so they did not know which app user made the change. We set <code>app.current_user_id</code> at the start of each transaction so that the audit trigger can read it.</li>
  <li><b>Small bugs found while testing.</b> For example, registering with an email that was already used gave a 400 error instead of 409. We found it while preparing this report and fixed it.</li>
  <li><b>AI and blockchain on the live server.</b> After deploying, report uploads on the live site showed "AI summary failed: fetch failed" and "Can't reach the blockchain node". The backend was still trying to reach Ollama and the Hardhat chain on its own machine, which only exist on our laptops. We turned anchoring off on the live server. For AI we first added Claude, but it is a paid API, so we switched to Groq's free API. The first model we chose was not available for our Groq key, so we made the backend pick an available model on its own (Section 10).</li>
</ol>

${h1(16)}
<table>
  <tr><th style="width:30%">Resource</th><th>Link</th></tr>
  <tr><td>GitHub repository</td><td>https://github.com/Zageraus/Elixo</td></tr>
  <tr><td>Commit history</td><td>https://github.com/Zageraus/Elixo/commits/main</td></tr>
  <tr><td>CI runs</td><td>https://github.com/Zageraus/Elixo/actions</td></tr>
  <tr><td>Database design document</td><td>https://github.com/Zageraus/Elixo/blob/main/docs/DATABASE_DESIGN.md</td></tr>
  <tr><td>Project proposal</td><td>https://github.com/Zageraus/Elixo/blob/main/docs/PROJECT_PROPOSAL.md</td></tr>
  <tr><td>SQL migrations</td><td>https://github.com/Zageraus/Elixo/tree/main/db/migrations</td></tr>
  <tr><td>Live application</td><td>https://elixor-dun.vercel.app</td></tr>
  <tr><td>Live API (health check)</td><td>https://elixor-backend.onrender.com/health</td></tr>
  <tr><td>Local setup</td><td>http://localhost:3000 (frontend), http://localhost:4000/health (API)</td></tr>
</table>
<table>
  <tr><th style="width:30%">Tool / library</th><th style="width:14%">Version</th><th>Link</th></tr>
  <tr><td>PostgreSQL on Supabase</td><td>17</td><td>https://supabase.com</td></tr>
  <tr><td>Prisma ORM</td><td>6.19</td><td>https://www.prisma.io</td></tr>
  <tr><td>Express.js</td><td>4.19</td><td>https://expressjs.com</td></tr>
  <tr><td>Next.js / React</td><td>14.2 / 18.3</td><td>https://nextjs.org</td></tr>
  <tr><td>Tailwind CSS</td><td>3.4</td><td>https://tailwindcss.com</td></tr>
  <tr><td>Zod</td><td>3.23</td><td>https://zod.dev</td></tr>
  <tr><td>jsonwebtoken</td><td>9.0</td><td>https://github.com/auth0/node-jsonwebtoken</td></tr>
  <tr><td>Groq API (free tier)</td><td>openai/gpt-oss-120b</td><td>https://console.groq.com</td></tr>
  <tr><td>Ollama</td><td>-</td><td>https://ollama.com</td></tr>
  <tr><td>Hardhat / Solidity</td><td>- / 0.8.24</td><td>https://hardhat.org</td></tr>
  <tr><td>Docker</td><td>-</td><td>https://www.docker.com</td></tr>
  <tr><td>GitHub Actions</td><td>-</td><td>https://docs.github.com/actions</td></tr>
  <tr><td>Render, Vercel</td><td>-</td><td>https://render.com, https://vercel.com</td></tr>
</table>
<p><b>APIs:</b> our own REST API (the endpoints are listed in the README), Supabase Auth and Storage, the Groq chat completions API, the Ollama local API and an Ethereum JSON-RPC node (Hardhat) for anchoring.</p>
<p><b>Dataset:</b> we did not use any external dataset. The sample data (doctors, patients, appointments, prescriptions, reports) was written by us and is in <code>db/seed/</code>. It does not have any real patient information.</p>

${h1(17)}
<h2>Conclusion</h2>
<p>In this project we built a working clinic management system on top of a properly designed relational database. The most useful things we learned were how much of the business logic can be put in the database itself using constraints, triggers and a stored procedure, why normalization matters in practice (we found two real problems in our own first design), and how transactions keep the data correct when many tables are changed together. We also got hands-on experience with an ORM, Git branching, Docker and CI, which we had not used much before this course.</p>
<h2>Future Work</h2>
<ul>
  <li>Adding a real payment gateway in test mode.</li>
  <li>Reading the text from uploaded PDF reports using OCR.</li>
  <li>A verification step for new doctor accounts.</li>
  <li>Deploying the smart contract on a public test network.</li>
  <li>Storing the login token in an httpOnly cookie instead of browser storage.</li>
</ul>

<h1 class="plain">References</h1>
<ol class="refs">
  <li>A. Silberschatz, H. F. Korth and S. Sudarshan, <i>Database System Concepts</i>, 7th ed. McGraw-Hill, 2019.</li>
  <li>R. Elmasri and S. B. Navathe, <i>Fundamentals of Database Systems</i>, 7th ed. Pearson, 2016.</li>
  <li>PostgreSQL Global Development Group, "PostgreSQL 17 Documentation." https://www.postgresql.org/docs/17/</li>
  <li>Prisma, "Prisma ORM Documentation." https://www.prisma.io/docs</li>
  <li>Supabase, "Supabase Documentation." https://supabase.com/docs</li>
  <li>Vercel, "Next.js Documentation." https://nextjs.org/docs</li>
  <li>OpenJS Foundation, "Express.js Documentation." https://expressjs.com</li>
  <li>Groq, "GroqCloud Documentation." https://console.groq.com/docs</li>
  <li>M. Jones, J. Bradley and N. Sakimura, "JSON Web Token (JWT)," RFC 7519, IETF, 2015.</li>
  <li>GitHub, "GitHub Actions Documentation." https://docs.github.com/actions</li>
</ol>
</body></html>`;

// ---------- print ----------
async function printPdf(b, html) {
  writeFileSync(here("./report2.html"), html);
  await b.goto("file:///" + here("./report2.html"), 4000);
  await b.waitFor(`[...document.images].every(i => i.complete && i.naturalWidth > 0)`, 60000);
  const r = await b.send("Page.printToPDF", {
    printBackground: true, transferMode: "ReturnAsStream", preferCSSPageSize: true, displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: `<div style="width:100%;font-size:10pt;font-family:'Times New Roman',serif;text-align:center;color:#000"><span class="pageNumber"></span></div>`,
  });
  const chunks = [];
  for (;;) {
    const part = await b.send("IO.read", { handle: r.stream, size: 1 << 20 });
    chunks.push(Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8"));
    if (part.eof) break;
  }
  await b.send("IO.close", { handle: r.stream });
  return Buffer.concat(chunks);
}

// Reads the PDF back with pdf.js and returns the text of every page.
async function pageTexts(b, pdf) {
  writeFileSync(here("./toc_reader.html"), `<!doctype html><html><body><script type="module">
import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs";
const bytes = Uint8Array.from(atob("${pdf.toString("base64")}"), c => c.charCodeAt(0));
const doc = await pdfjs.getDocument({ data: bytes }).promise;
const out = [];
for (let n = 1; n <= doc.numPages; n++) out.push((await (await doc.getPage(n)).getTextContent()).items.map(i => i.str).join(" "));
window.__texts = out;
</script></body></html>`);
  await b.goto("file:///" + here("./toc_reader.html"), 2000);
  await b.waitFor("Array.isArray(window.__texts)", 120000);
  return (await b.eval("window.__texts")).map((t) => t.replace(/\s+/g, " ").trim().toUpperCase());
}

const b = await launch({ port: 9340, profile: here("./edge-cdp-pdf2/"), width: 1240, height: 1754, scale: 1 });
try {
  const first = await printPdf(b, page(tocRows()));
  const texts = await pageTexts(b, first);
  const tocPage = texts.findIndex((t) => t.includes("CONTENTS")) + 1;
  const pages = {};
  // Sections no longer start on a new page, so the next one may be on the same page; compare without spaces.
  const flat = texts.map((t) => t.replace(/\s+/g, ""));
  let from = tocPage;
  CH.forEach((t, i) => {
    const heading = `${i + 1}.${t}`.replace(/\s+/g, "").toUpperCase();
    const idx = flat.findIndex((x, k) => k >= from && x.includes(heading));
    if (idx >= 0) { pages[i + 1] = idx + 1; from = idx; }
  });
  const ref = texts.findIndex((x, k) => k >= from && x.includes("REFERENCES") && x.includes("SILBERSCHATZ"));
  if (ref >= 0) pages.ref = ref + 1;
  console.log("section pages", JSON.stringify(pages));
  const pdf = await printPdf(b, page(tocRows(pages)));
  writeFileSync(OUT_PDF, pdf);
  console.log("wrote", OUT_PDF, Math.round(pdf.length / 1024), "KB, pages:", texts.length);
} finally {
  await b.close();
}
