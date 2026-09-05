#!/usr/bin/env node
/**
 * Regenerates sitemap.xml from public best-radar repositories.
 * GitHub Pages is static - re-run this after publishing new bradar-* repos.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const USER = "best-radar";
const SITE = "https://best-radar.github.io";
const EXCLUDE = new Set([USER, `${USER}.github.io`]);
const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "sitemap.xml");

async function fetchRepos() {
  const url = `https://api.github.com/users/${USER}/repos?per_page=100&sort=updated`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "best-radar-sitemap",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  return data.filter((r) => !r.fork && !EXCLUDE.has(r.name));
}

function isoDay(d) {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function urlEntry(loc, lastmod, changefreq, priority) {
  return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

const repos = await fetchRepos();
const today = isoDay(new Date());
const latest = repos.reduce((max, r) => {
  const t = +new Date(r.updated_at || 0);
  return t > max ? t : max;
}, 0);
const siteLastmod = latest ? isoDay(latest) : today;

const entries = [
  urlEntry(`${SITE}/`, siteLastmod, "daily", "1.0"),
  urlEntry(`${SITE}/#showcase`, siteLastmod, "daily", "0.9"),
  urlEntry(`${SITE}/#about`, today, "monthly", "0.5"),
  urlEntry(`${SITE}/#faq`, today, "monthly", "0.5"),
];

for (const repo of repos) {
  const q = encodeURIComponent(repo.name);
  entries.push(
    urlEntry(`${SITE}/?q=${q}`, isoDay(repo.updated_at), "weekly", "0.7"),
  );
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;

writeFileSync(outPath, xml, "utf8");
console.log(`Wrote ${outPath} (${entries.length} URLs)`);
