// Fetches the commit history (with changed files) of the team's earlier repositories from the GitHub API.
import { writeFileSync } from "fs";
const here = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const REPOS = ["Zageraus/Healthcare", "Arnahhh/HealthChain-Finalised", "Arnahhh/HealthChain-AI-and-BlockChain-integrated-", "Arnahhh/Elixor-update"];
const gh = async (path) => {
  const r = await fetch(`https://api.github.com/${path}`, { headers: { "User-Agent": "elixor-report" } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
};
const out = {};
for (const repo of REPOS) {
  try {
    const info = await gh(`repos/${repo}`);
    const branches = (await gh(`repos/${repo}/branches?per_page=100`)).map((b) => b.name);
    const commits = [];
    const seen = new Set();
    for (const br of branches) {
      for (let page = 1; page < 5; page++) {
        const list = await gh(`repos/${repo}/commits?sha=${encodeURIComponent(br)}&per_page=100&page=${page}`);
        for (const c of list) {
          if (seen.has(c.sha)) continue;
          seen.add(c.sha);
          commits.push({ sha: c.sha, branch: br, author: c.commit.author.name, email: c.commit.author.email, login: c.author?.login ?? null, date: c.commit.author.date, message: c.commit.message.split("\n")[0], parents: c.parents.length });
        }
        if (list.length < 100) break;
      }
    }
    out[repo] = { created_at: info.created_at, default_branch: info.default_branch, fork: info.fork, parent: info.parent?.full_name ?? null, branches, commits };
    console.log(repo, "branches:", branches.join(","), "commits:", commits.length);
  } catch (e) {
    out[repo] = { error: e.message };
    console.log(repo, "ERROR", e.message.slice(0, 120));
  }
}
writeFileSync(here("./repos.json"), JSON.stringify(out, null, 1));
