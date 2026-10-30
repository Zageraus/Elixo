// Fills the commit tables into the report template and prints it to PDF with headless Edge.
import { readFileSync, writeFileSync } from "fs";
import { launch, sleep } from "./cdp.mjs";

const here = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const OUT_PDF = process.argv[2] ?? "C:/Users/ssani/Desktop/ELIXOR/docs/ELIXOR_Project_Report.pdf";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// commits.txt: short|full|date|author|email|parents|subject  (oldest first, from `git log dev --reverse`)
const commits = readFileSync(here("./commits.txt"), "utf-8").trim().split(/\r?\n/).map((l) => {
  const [short, full, date, author, email, parents, ...msg] = l.split("|");
  return { short, full, date, author, email, parents: parents.split(" "), subject: msg.join("|") };
});

const IMPROVEMENT_START = "28 Oct 2026";
const LOCAL_ONLY = new Set(["7bfab2a", "18918c0"]); // committed on 29 Oct, pushed with this report
const improvementIds = new Set(["611694b", "4fa0cdd", "0cc5722", "6ff0fc6", "f0ef5fa", "ddd0827", "2ac37ae", "7bfab2a", "18918c0"]);

function member(c) {
  if (c.email === "ssanidhya886@gmail.com") return { name: "[Member 1]", id: "Zageraus" };
  if (c.email === "arnaadhikari2006@gmail.com") return { name: "[Member 2]", id: "Arnahhh" };
  return { name: "[Member 2]?", id: `${c.author} (email not linked to a GitHub account)` };
}
function branch(c) {
  if (c.short === "d534716") return "healthchain-upgrade (PR #1)";
  if (c.short === "ba54fd3") return "main (merge of PR #1)";
  if (improvementIds.has(c.short)) return "dev → main";
  return "main";
}

const rows = commits.map((c) => {
  const m = member(c);
  return `<tr><td>${esc(m.name)}</td><td><span class="ph">[Reg. No]</span></td><td>${esc(m.id)}</td><td>${esc(branch(c))}</td><td>${esc(c.short)}</td><td>${esc(c.date)}</td><td>${esc(c.subject)}</td></tr>`;
}).join("\n");

const byMember = new Map();
for (const c of commits) {
  const m = member(c);
  const key = `${m.name}|${m.id.split(" ")[0]}`;
  const e = byMember.get(key) ?? { name: m.name, id: m.id.split(" ")[0], n: 0, first: c.date, last: c.date };
  e.n++; e.last = c.date; byMember.set(key, e);
}
const summary = `<table><tr><th>Member</th><th>GitHub ID</th><th>Commits</th><th>First commit</th><th>Latest commit</th></tr>${[...byMember.values()]
  .map((e) => `<tr><td>${esc(e.name)}</td><td>${esc(e.id)}</td><td>${e.n}</td><td>${esc(e.first)}</td><td>${esc(e.last)}</td></tr>`).join("")}
  <tr><th colspan="2">Total</th><th>${commits.length}</th><th colspan="2"></th></tr></table>`;

const describe = {
  "611694b": "Migration 012: <code>prescription_items</code> table (1NF), dropped transitively dependent payment columns (3NF), stored procedure <code>sp_create_prescription</code>, prescription/appointment trigger, search and paging indexes",
  "4fa0cdd": "All table access moved to Prisma ORM; six multi-step operations in transactions (row lock on checkout); audit trail records the acting user; <code>GET /api/auth/me</code>; patient health profile API; server-side pagination and search; central error handler",
  "0cc5722": "Health profile form and allergy warnings; pagers on prescriptions and reports; server-side admin search, status filter and paging; <code>RoleGate</code> page protection",
  "6ff0fc6": "Admin dashboard header tidy-up",
  "f0ef5fa": "ER diagram, relational schema, data dictionary, normalization proof; project proposal with Gantt chart",
  "ddd0827": "Dockerfiles, docker-compose, GitHub Actions CI, <code>pg_dump</code>/<code>pg_restore</code> scripts, Render blueprint, .gitignore hardening",
  "2ac37ae": "README updated for Prisma, transactions, Docker, backups and CI",
  "7bfab2a": "Registering an existing email now returns 409 Conflict instead of 400",
  "18918c0": "Plain-language project overview PDF",
};
const imp = commits.filter((c) => improvementIds.has(c.short)).map((c) =>
  `<tr><td>${esc(c.short)}</td><td>${esc(c.date)}</td><td>${esc(c.subject)}</td><td>${describe[c.short] ?? ""}</td></tr>`).join("");
const improvements = `<p class="small">Listed provisionally as everything from ${IMPROVEMENT_START} onward; adjust to the first-review date.</p>
<table><tr><th style="width:9%">Commit ID</th><th style="width:13%">Date</th><th style="width:28%">Commit message</th><th>What changed</th></tr>${imp}</table>`;

let html = readFileSync(here("./report_template.html"), "utf-8")
  .replace("{{COMMITS}}", rows)
  .replace("{{COMMIT_SUMMARY}}", summary)
  .replace("{{IMPROVEMENTS}}", improvements);
writeFileSync(here("./report.html"), html);

console.log("launching"); const b = await launch({ port: 9338, profile: here("./edge-cdp-pdf/"), width: 1240, height: 1754, scale: 1 });
try {
  console.log("navigating"); await b.goto("file:///" + here("./report.html"), 4000); console.log("loaded", await b.eval("document.title + ' ' + document.images.length"));
  await b.waitFor(`[...document.images].every(i => i.complete && i.naturalWidth > 0)`, 60000);
  const missing = await b.eval(`[...document.images].filter(i => !i.naturalWidth).map(i => i.src)`);
  if (missing.length) console.log("MISSING IMAGES", missing);
  console.log("printing"); const r = await b.send("Page.printToPDF", {
    printBackground: true, transferMode: "ReturnAsStream", preferCSSPageSize: true, displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: `<div style="width:100%;font-size:7.5pt;color:#777;padding:0 14mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial"><span>ELIXOR · Database Systems (BCSE307L) project report</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  const chunks = [];
  for (;;) {
    const part = await b.send("IO.read", { handle: r.stream, size: 1 << 20 });
    chunks.push(Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8"));
    if (part.eof) break;
  }
  await b.send("IO.close", { handle: r.stream });
  const pdf = Buffer.concat(chunks);
  writeFileSync(OUT_PDF, pdf);
  console.log("wrote", OUT_PDF, Math.round(pdf.length / 1024), "KB");
} finally {
  await b.close();
}
