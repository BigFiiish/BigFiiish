/**
 * Regenerates the "Currently building" line and "Featured projects"
 * section in README.md from GitHub public repos + projects.json.
 *
 * New public, non-fork repos appear automatically. Add a blurb in
 * projects.json when you want a tighter write-up than the GitHub description.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "projects.json"), "utf8"));
const readmePath = join(root, "README.md");

const BUILDING_START = "<!-- BUILDING:START -->";
const BUILDING_END = "<!-- BUILDING:END -->";
const FEATURED_START = "<!-- FEATURED:START -->";
const FEATURED_END = "<!-- FEATURED:END -->";

async function githubRepos(login) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": `${login}-profile-sync`,
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const url = `https://api.github.com/users/${login}/repos?type=owner&sort=pushed&per_page=100&page=${page}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
    }
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

function displayName(repo, curated) {
  return curated?.title ?? repo.name;
}

function repoLink(repo, curated) {
  const title = displayName(repo, curated);
  return `**[${title}](${repo.html_url})**`;
}

function shortLabel(repo, curated) {
  if (curated?.short) return curated.short;
  const source = repo.description ?? "";
  const first = source.split(/[.…]/)[0]?.trim() ?? "";
  if (!first) return repo.name;
  return first.length > 56 ? `${first.slice(0, 55)}…` : first;
}

function featuredBlurb(repo, curated) {
  const body = (curated?.blurb ?? repo.description ?? "").trim();
  const live = curated?.live || repo.homepage;
  const liveBit = live ? ` Live: [${live.replace(/^https?:\/\//, "")}](${live}).` : "";
  if (!body) {
    return `${repoLink(repo, curated)} — public project.${liveBit}`;
  }
  const needsPeriod = !/[.!?]$/.test(body);
  return `${repoLink(repo, curated)} — ${body}${needsPeriod ? "." : ""}${liveBit}`;
}

function replaceBlock(source, start, end, inner) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end);
  if (startAt === -1 || endAt === -1 || endAt < startAt) {
    throw new Error(`Missing ${start} / ${end} markers in README.md`);
  }
  return (
    source.slice(0, startAt + start.length) +
    inner +
    source.slice(endAt)
  );
}

function buildingLine(ordered, curatedByRepo, limit) {
  const shown = ordered.slice(0, limit);
  const parts = shown.map((repo) => {
    const curated = curatedByRepo.get(repo.name);
    return `${repoLink(repo, curated)} (${shortLabel(repo, curated)})`;
  });
  if (parts.length === 0) return "Currently building public projects on GitHub";
  if (parts.length === 1) return `Currently building ${parts[0]}`;
  if (parts.length === 2) return `Currently building ${parts[0]} and ${parts[1]}`;
  return `Currently building ${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

const repos = (await githubRepos(config.login)).filter((repo) => {
  if (repo.fork || repo.private) return false;
  if ((config.ignore ?? []).includes(repo.name)) return false;
  return true;
});

const byName = new Map(repos.map((repo) => [repo.name, repo]));
const curatedByRepo = new Map(
  (config.featured ?? []).map((item) => [item.repo, item]),
);

const ordered = [];
const seen = new Set();
for (const item of config.featured ?? []) {
  const repo = byName.get(item.repo);
  if (!repo) continue;
  ordered.push(repo);
  seen.add(repo.name);
}
for (const repo of repos) {
  if (seen.has(repo.name)) continue;
  ordered.push(repo);
  seen.add(repo.name);
}

const featuredInner =
  "\n\n" +
  ordered.map((repo) => featuredBlurb(repo, curatedByRepo.get(repo.name))).join("\n\n") +
  "\n\n";

const buildingInner = buildingLine(
  ordered,
  curatedByRepo,
  config.buildingLimit ?? 5,
);

let readme = readFileSync(readmePath, "utf8");
readme = replaceBlock(readme, BUILDING_START, BUILDING_END, buildingInner);
readme = replaceBlock(readme, FEATURED_START, FEATURED_END, featuredInner);
writeFileSync(readmePath, readme);
console.log(`Synced ${ordered.length} public project(s) into README.md`);
