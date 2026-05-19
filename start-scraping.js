// ============================================================
// Hamro CSIT — Question Bank Scraper (any semester)
// ============================================================
// SETUP (one time):
//   npm init -y
//   npm install playwright chalk
//   npx playwright install chromium
//
// RUN:
//   node start-scraping.js
//
// OUTPUT:
//   output/<semester-word>/<subject-slug>.txt
//   One file per subject, sorted by year, model questions marked
// ============================================================

"use strict";

const { chromium } = require("playwright");
const fs           = require("fs");
const readline     = require("readline");
const path         = require("path");
const os           = require("os");
const { execSync, execFile } = require("child_process");
const util          = require("util");
const execFileAsync = util.promisify(execFile);
const chalk         = require("chalk");

const SITE     = "https://hamrocsit.com";
const DELAY_MS = 2000;

// Maps digit → word used in hamrocsit.com URLs
const SEMESTER_WORDS = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  5: "fifth",
  6: "sixth",
  7: "seventh",
  8: "eight",   // site spells it "eight", not "eighth"
};

// ── Strip ANSI codes to get visual length ─────────────────────
const visualLen = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

// ── Draw a box line padded to terminal width ──────────────────
const boxLine = (inner, W) => {
  const pad = Math.max(0, W - 2 - visualLen(inner));
  return `${chalk.cyan("│")}${inner}${" ".repeat(pad)}${chalk.cyan("│")}\n`;
};

// ── TUI Config Screen ─────────────────────────────────────────
async function runConfigScreen() {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  // Enter alternate screen buffer, hide cursor
  process.stdout.write("\x1b[?1049h\x1b[?25l");

  const MODES = [
    { id: "qbanks",   label: "Question Banks only"              },
    { id: "syllabus", label: "Syllabus only"                    },
    { id: "both",     label: "Question Banks + Syllabus"        },
    { id: "organize", label: "Organize Questions (AI-assisted)" },
  ];

  const fields = [
    { id: "semester", label: "Semester",    type: "number", value: 1, min: 1, max: 8 },
    { id: "mode",     label: "Scrape mode", type: "list",   value: 0, options: MODES },
  ];

  let activeIdx = 0;
  let errorMsg  = "";

  const render = () => {
    const W = process.stdout.columns || 80;
    const H = process.stdout.rows    || 24;

    if (W < 72 || H < 18) {
      process.stdout.write("\x1b[H\x1b[2J");
      process.stdout.write(`\n  ${chalk.bold.yellow("▲ Terminal too small — resize to at least 72×18")}\n`);
      return;
    }

    let out = "\x1b[H";

    const title     = " HAMRO CSIT SCRAPER ";
    const topPad    = Math.max(0, W - 6 - visualLen(title));
    out += chalk.cyan("╭────" + chalk.bold.white(title) + "─".repeat(topPad) + "╮") + "\n";

    const hint = chalk.dim(" ↑/↓ navigate  ←/→ or +/- change value  Enter confirm ");
    out += boxLine(" " + hint, W);
    out += chalk.cyan("├" + "─".repeat(W - 2) + "┤") + "\n";
    out += boxLine("", W);

    for (let i = 0; i < fields.length; i++) {
      const f        = fields[i];
      const active   = i === activeIdx;
      const labelStr = (active ? chalk.bold.cyan : chalk.white)(f.label.padEnd(18));

      let valStr = "";
      if (f.type === "number") {
        const display = `Semester ${f.value}  (${SEMESTER_WORDS[f.value]})`;
        valStr = active
          ? chalk.bgCyan.black(` ◀ ${display.padEnd(28)} ▶ `)
          : chalk.gray(`< ${display.padEnd(28)} >`);
      } else if (f.type === "list") {
        const opt = f.options[f.value];
        valStr = active
          ? chalk.bgCyan.black(` ◀ ${opt.label.padEnd(34)} ▶ `)
          : chalk.gray(`< ${opt.label.padEnd(34)} >`);
      }

      out += boxLine(`    ${labelStr}  ${valStr}`, W);
      out += boxLine("", W);
    }

    // Submit button
    const btnText  = " START SCRAPING ";
    const btnRaw   = activeIdx === fields.length
      ? chalk.bgGreen.bold.black(btnText)
      : chalk.bold.gray(btnText);
    const btnPad   = Math.floor((W - 4 - visualLen(btnText)) / 2);
    out += boxLine(" ".repeat(Math.max(0, btnPad)) + btnRaw, W);
    out += boxLine("", W);

    if (errorMsg) {
      out += boxLine("  " + chalk.bgRed.bold.white(`  ▲ ${errorMsg}  `), W);
    }

    // Fill remaining rows
    const drawnLines = 6 + fields.length * 2 + 3 + (errorMsg ? 1 : 0);
    for (let r = drawnLines; r < H - 2; r++) out += boxLine("", W);

    const footer    = chalk.dim(" Hamro CSIT Scraper • Configuration ");
    const footerPad = Math.max(0, W - 6 - visualLen(footer));
    out += chalk.cyan("╰────" + footer + "─".repeat(footerPad) + "╯");

    process.stdout.write(out);
  };

  // Handle terminal resize
  const onResize = () => render();
  process.stdout.on("resize", onResize);

  render();

  return new Promise((resolve) => {
    const onKey = (str, key) => {
      if (key.ctrl && key.name === "c") {
        process.stdout.write("\x1b[?1049l\x1b[?25h");
        process.exit(0);
      }

      errorMsg = "";
      const totalItems = fields.length + 1; // fields + submit button

      if (key.name === "up") {
        activeIdx = Math.max(0, activeIdx - 1);
      } else if (key.name === "down") {
        activeIdx = Math.min(totalItems - 1, activeIdx + 1);
      } else if (key.name === "return") {
        if (activeIdx === fields.length) {
          // Submit
          process.stdin.removeListener("keypress", onKey);
          process.stdout.removeListener("resize", onResize);
          resolve({
            semester: fields[0].value,
            modeId:   fields[1].options[fields[1].value].id,
          });
          return;
        } else {
          activeIdx = Math.min(totalItems - 1, activeIdx + 1);
        }
      } else if (key.name === "left" || str === "-") {
        const f = fields[activeIdx];
        if (!f) return render();
        if (f.type === "number") f.value = Math.max(f.min, f.value - 1);
        if (f.type === "list")   f.value = (f.value - 1 + f.options.length) % f.options.length;
      } else if (key.name === "right" || str === "+") {
        const f = fields[activeIdx];
        if (!f) return render();
        if (f.type === "number") f.value = Math.min(f.max, f.value + 1);
        if (f.type === "list")   f.value = (f.value + 1) % f.options.length;
      }

      render();
    };

    process.stdin.on("keypress", onKey);
  });
}

// ── TUI Dashboard ─────────────────────────────────────────────
const SPINNER = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
let spinIdx = 0;
let spinTimer = null;

const dashState = {
  subjects:    {},   // slug → { qbankStatus, syllabusStatus, qbankCount, error }
  activeSlug:  null,
  activeTask:  "",
  phase:       "scraping", // "scraping" | "done"
  totalDone:   0,
  totalCount:  0,
};

function renderDashboard(subjectSlugs, semesterWord, modeId) {
  const W = process.stdout.columns || 80;
  const H = process.stdout.rows    || 24;

  const scrapeQBanks  = modeId === "qbanks"   || modeId === "both";
  const scrapeSyllabus = modeId === "syllabus" || modeId === "both";
  const isOrganize    = modeId === "organize";

  const fmtStatus = (status) => {
    if (!status || status === "pending") return chalk.dim("Pending");
    if (status === "active")             return chalk.bold.cyan("Active ");
    if (status === "done")               return chalk.green("Done   ");
    if (status === "skipped")            return chalk.yellow("Skipped");
    if (status === "error")              return chalk.red("Error  ");
    return chalk.dim("─      ");
  };

  let out = "\x1b[H";

  const title    = " HAMRO CSIT SCRAPER — LIVE ";
  const topPad   = Math.max(0, W - 6 - visualLen(title));
  out += chalk.cyan("╭────" + chalk.bold.magenta(title) + "─".repeat(topPad) + "╮") + "\n";

  const modeLabel = isOrganize ? "Organize" : `${modeId}`;
  const sub = ` ${chalk.dim("Semester:")} ${chalk.yellow(semesterWord)}  ${chalk.dim("Mode:")} ${chalk.white(modeLabel)}  ${chalk.dim("Progress:")} ${chalk.green(dashState.totalDone + "/" + dashState.totalCount)} `;
  out += boxLine(sub, W);
  out += chalk.cyan("├" + "─".repeat(W - 2) + "┤") + "\n";

  // Active task line
  out += boxLine("  " + chalk.bold.white("CURRENT TASK"), W);
  const spinPrefix = dashState.activeSlug ? SPINNER[spinIdx] + " " : "";
  const taskLine = dashState.activeSlug
    ? chalk.cyan(`[${dashState.activeSlug}] `) + chalk.white(spinPrefix + dashState.activeTask)
    : chalk.dim(dashState.activeTask || "");
  out += boxLine("    " + taskLine, W);
  out += chalk.cyan("├" + "─".repeat(W - 2) + "┤") + "\n";

  // Per-subject rows
  out += boxLine("  " + chalk.bold.white("SUBJECTS"), W);

  for (const slug of subjectSlugs) {
    const s = dashState.subjects[slug] || {};
    const isActive = dashState.activeSlug === slug;
    const nameStr  = (isActive ? chalk.bold.cyan : chalk.white)(slug.padEnd(28).slice(0, 28));

    let colParts = [];
    if (scrapeQBanks || isOrganize) {
      colParts.push(`QB: ${fmtStatus(s.qbankStatus)}`);
    }
    if (scrapeSyllabus) {
      colParts.push(`SY: ${fmtStatus(s.syllabusStatus)}`);
    }
    if (s.qbankCount !== undefined) {
      colParts.push(chalk.dim(`${s.qbankCount}q`));
    }
    if (s.error) {
      colParts.push(chalk.red("✖ " + s.error.slice(0, 20)));
    }

    const cols = colParts.join("  ");
    const rowPad = Math.max(0, W - 8 - visualLen(nameStr) - visualLen(cols));
    out += boxLine(`  ◆ ${nameStr}${" ".repeat(rowPad)}${cols}`, W);
  }

  // Fill space
  const drawnLines = 7 + subjectSlugs.length + 1;
  for (let r = drawnLines; r < H - 3; r++) out += boxLine("", W);

  out += chalk.cyan("├" + "─".repeat(W - 2) + "┤") + "\n";

  // Bottom status
  const bottomMsg = dashState.phase === "done"
    ? chalk.green.bold("✔ Complete! Press any key to exit.")
    : chalk.dim(" Press Ctrl+C to abort ");
  out += boxLine("  " + bottomMsg, W);

  const footer    = chalk.dim(" Hamro CSIT Scraper • Running ");
  const footerPad = Math.max(0, W - 6 - visualLen(footer));
  out += chalk.cyan("╰────" + footer + "─".repeat(footerPad) + "╯");

  process.stdout.write(out);
}

function startDashboard(subjectSlugs, semesterWord, modeId) {
  process.stdout.write("\x1b[2J\x1b[H");
  renderDashboard(subjectSlugs, semesterWord, modeId);
  spinTimer = setInterval(() => {
    spinIdx = (spinIdx + 1) % SPINNER.length;
    renderDashboard(subjectSlugs, semesterWord, modeId);
  }, 80);
}

function stopDashboard() {
  if (spinTimer) { clearInterval(spinTimer); spinTimer = null; }
}

function setTask(slug, text) {
  dashState.activeSlug = slug;
  dashState.activeTask = text; // plain text — spinner prepended at render time
}

function setSubjectStatus(slug, field, value) {
  if (!dashState.subjects[slug]) dashState.subjects[slug] = {};
  dashState.subjects[slug][field] = value;
}

// ── Loading / status screen shown while browser warms up ─────
function renderLoadingScreen(message) {
  const W = process.stdout.columns || 80;
  const H = process.stdout.rows    || 24;

  let out = "\x1b[H";

  const title  = " HAMRO CSIT SCRAPER ";
  const topPad = Math.max(0, W - 6 - visualLen(title));
  out += chalk.cyan("╭────" + chalk.bold.white(title) + "─".repeat(topPad) + "╮") + "\n";

  for (let i = 1; i < H - 3; i++) {
    if (i === Math.floor((H - 3) / 2)) {
      out += boxLine("  " + chalk.bold.cyan(message), W);
    } else {
      out += boxLine("", W);
    }
  }

  const footer    = chalk.dim(" Please wait... ");
  const footerPad = Math.max(0, W - 6 - visualLen(footer));
  out += chalk.cyan("╰────" + footer + "─".repeat(footerPad) + "╯");

  process.stdout.write(out);
}

// ── TUI subject selector (keyboard-driven checkbox) ───────────
async function selectSubjects(subjects) {
  if (subjects.length === 0) return [];

  const checked = new Array(subjects.length).fill(true);
  let cursorIdx = 0;
  const PAGE_SIZE = Math.min(subjects.length, (process.stdout.rows || 24) - 10);
  let scrollOffset = 0;

  const render = () => {
    const W = process.stdout.columns || 80;
    const H = process.stdout.rows    || 24;

    let out = "\x1b[H";

    const title  = " SELECT SUBJECTS ";
    const topPad = Math.max(0, W - 6 - visualLen(title));
    out += chalk.cyan("╭────" + chalk.bold.white(title) + "─".repeat(topPad) + "╮") + "\n";

    const hint = chalk.dim(" ↑/↓ move  Space toggle  A select all  N deselect all  Enter confirm ");
    out += boxLine(" " + hint, W);
    out += chalk.cyan("├" + "─".repeat(W - 2) + "┤") + "\n";

    const selectedCount = checked.filter(Boolean).length;
    out += boxLine("  " + chalk.bold.white("Subjects found: ") + chalk.cyan(subjects.length) + "   " + chalk.bold.white("Selected: ") + chalk.green(selectedCount), W);
    out += boxLine("", W);

    if (cursorIdx < scrollOffset) scrollOffset = cursorIdx;
    if (cursorIdx >= scrollOffset + PAGE_SIZE) scrollOffset = cursorIdx - PAGE_SIZE + 1;

    const visibleSubjects = subjects.slice(scrollOffset, scrollOffset + PAGE_SIZE);

    for (let i = 0; i < visibleSubjects.length; i++) {
      const realIdx   = i + scrollOffset;
      const isActive  = realIdx === cursorIdx;
      const isChecked = checked[realIdx];

      const checkbox  = isChecked ? chalk.green("◉") : chalk.dim("◎");
      const nameColor = isActive ? chalk.bgCyan.black : (isChecked ? chalk.white : chalk.dim);
      const arrow     = isActive ? chalk.cyan(" ▶ ") : "   ";
      const name      = nameColor(subjects[realIdx].slug.padEnd(W - 12));

      out += boxLine(arrow + checkbox + "  " + name, W);
    }

    if (subjects.length > PAGE_SIZE) {
      const pct = Math.round((scrollOffset / Math.max(1, subjects.length - PAGE_SIZE)) * 100);
      out += boxLine(chalk.dim("  ↕  Showing " + (scrollOffset + 1) + "–" + Math.min(scrollOffset + PAGE_SIZE, subjects.length) + " of " + subjects.length + "  (" + pct + "%)"), W);
    }

    const drawnLines = 5 + visibleSubjects.length + (subjects.length > PAGE_SIZE ? 1 : 0) + 2;
    for (let r = drawnLines; r < H - 3; r++) out += boxLine("", W);

    const selectedCount2 = checked.filter(Boolean).length;
    const btnText  = selectedCount2 > 0
      ? " START WITH " + selectedCount2 + " SUBJECT" + (selectedCount2 > 1 ? "S" : "") + " "
      : " NO SUBJECTS SELECTED ";
    const btnColor = selectedCount2 > 0 ? chalk.bgGreen.bold.black : chalk.bgRed.bold.white;
    const btnPad   = Math.floor((W - 4 - btnText.length) / 2);
    out += chalk.cyan("├" + "─".repeat(W - 2) + "┤") + "\n";
    out += boxLine(" ".repeat(Math.max(0, btnPad)) + btnColor(btnText), W);

    const footer    = chalk.dim(" Hamro CSIT Scraper • Subject Selection ");
    const footerPad = Math.max(0, W - 6 - visualLen(footer));
    out += chalk.cyan("╰────" + footer + "─".repeat(footerPad) + "╯");

    process.stdout.write(out);
  };

  process.stdout.on("resize", render);
  render();

  return new Promise((resolve) => {
    const onKey = (str, key) => {
      if (key.ctrl && key.name === "c") {
        process.stdout.write("\x1b[?1049l\x1b[?25h");
        process.exit(0);
      }

      if (key.name === "up") {
        cursorIdx = Math.max(0, cursorIdx - 1);
      } else if (key.name === "down") {
        cursorIdx = Math.min(subjects.length - 1, cursorIdx + 1);
      } else if (str === " ") {
        checked[cursorIdx] = !checked[cursorIdx];
      } else if (str === "a" || str === "A") {
        checked.fill(true);
      } else if (str === "n" || str === "N") {
        checked.fill(false);
      } else if (key.name === "return") {
        const selectedCount = checked.filter(Boolean).length;
        if (selectedCount === 0) { render(); return; }
        process.stdin.removeListener("keypress", onKey);
        process.stdout.removeListener("resize", render);
        resolve(subjects.filter((_, i) => checked[i]));
        return;
      }

      render();
    };

    process.stdin.on("keypress", onKey);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getYear(label) { const m = label.match(/\b(20\d{2})\b/); return m ? parseInt(m[1]) : 0; }
function isModel(label) { return /model/i.test(label); }

// ── Extract text from element, with line breaks ────────────────
function extractText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8230;/g, "...")
    .replace(/&nbsp;/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// ── Discover subjects from the semester index page ────────────
// e.g. https://hamrocsit.com/semester/seventh/
// Subject links look like: /semester/seventh/advanced-java/
// We grab all hrefs under that path that have exactly one extra segment.

async function getSubjects(page, semesterWord) {
  const basePath = `/semester/${semesterWord}/`;

  const links = await page.$$eval("a[href]", (els, basePath) =>
    els.map(a => ({ href: a.href, text: (a.innerText || a.textContent || "").trim() })),
    basePath
  );

  const seen = new Set();
  const subjects = [];

  for (const { href, text } of links) {
    const url = new URL(href);
    // must be on the same host and start with /semester/<word>/
    if (!url.pathname.startsWith(basePath)) continue;

    // the segment after the base path — e.g. "advanced-java" or "advanced-java/"
    const rest = url.pathname.slice(basePath.length).replace(/\/$/, "");

    // exactly one segment (no further slashes) and non-empty
    if (!rest || rest.includes("/")) continue;

    if (seen.has(rest)) continue;
    seen.add(rest);

    subjects.push({ slug: rest, name: text || rest });
  }

  return subjects;
}

// ── Strip HTML tags from a string ─────────────────────────────
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8230;/g, "...")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Extract syllabus content from a syllabus page ──────────────
async function extractSyllabus(page) {
  const content = await page.evaluate(() => {
    const container = document.querySelector(".syllabus_container");
    if (!container) return null;
    
    return {
      header: (() => {
        const headerDiv = container.querySelector(".syllabus_header");
        return headerDiv ? headerDiv.innerText.trim() : "";
      })(),
      courseMetadata: (() => {
        // Extract just the course metadata (title, code, marks, etc.) - first level children only
        const courseDiv = container.querySelector(".complete_header_syllabus");
        if (!courseDiv) return "";
        
        const metadata = [];
        for (let child of courseDiv.children) {
          if (child.tagName === "DIV" && !child.querySelector(".syllabus_item")) {
            metadata.push(child.innerText.trim());
          }
        }
        return metadata.join("\n");
      })(),
      units: (() => {
        const items = container.querySelectorAll(".syllabus_item");
        return Array.from(items).map(item => {
          const title = item.querySelector("h6");
          const desc = item.querySelector("p");
          return {
            title: title ? title.innerText.trim() : "",
            description: desc ? desc.innerText.trim() : ""
          };
        });
      })(),
      labWorks: (() => {
        const allHeadings = container.querySelectorAll("h5.syllabus_title");
        for (let h of allHeadings) {
          if (/laboratory/i.test(h.innerText)) {
            const next = h.nextElementSibling;
            return next ? next.innerText.trim() : "";
          }
        }
        return "";
      })(),
      textBooks: (() => {
        const allHeadings = container.querySelectorAll("h5.syllabus_title");
        for (let h of allHeadings) {
          if (/text\s*book/i.test(h.innerText)) {
            const list = h.nextElementSibling;
            if (list && list.classList.contains("book_list")) {
              return list.innerText.trim();
            }
          }
        }
        return "";
      })(),
      referenceBooks: (() => {
        const allHeadings = container.querySelectorAll("h5.syllabus_title");
        for (let h of allHeadings) {
          if (/reference\s*book/i.test(h.innerText)) {
            const list = h.nextElementSibling;
            if (list && list.classList.contains("book_list")) {
              return list.innerText.trim();
            }
          }
        }
        return "";
      })()
    };
  });
  
  return content;
}

// ── Get paper links from the index page ───────────────────────
// The sidebar `.course-index ul li a` holds links like:
//   https://hamrocsit.com/semester/seventh/advanced-java//question-bank/2081
//
// We match only those that contain /question-bank/ + a segment after it.

async function getPaperLinks(page, semesterWord, slug) {
  const links = await page.$$eval(".course-index ul li a", els =>
    els.map(a => ({ href: a.href, text: a.innerText.trim() }))
  );

  const seen = new Set();
  const results = [];

  for (const { href, text } of links) {
    const url = href.replace(/([^:])\/\/+/g, "$1/");

    // must contain /question-bank/ with something after it
    const m = url.match(/\/question-bank\/(.+)/);
    if (!m || seen.has(url)) continue;
    seen.add(url);

    const label = text || m[1];
    results.push({ label, url, year: getYear(label), isModel: isModel(label) });
  }

  // newest year first; model sets last within same year
  results.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return Number(a.isModel) - Number(b.isModel);
  });

  return results;
}

// ── Extract questions from a paper page ───────────────────────
//
// The page embeds ALL question data in an inline <script> block:
//
//   const qnbankdata = { "64239": { rawtitle: "...", ... }, ... };
//
// `rawtitle` is plain text; `title` is HTML.  We prefer rawtitle.
//
// Fallback: scrape the visible DOM using .qnbank_content inside
// each .single_question_container, reading the number from
// .qnbank_number.

async function extractQuestions(page) {
  // ── Strategy 1: pull from the embedded JS object ────────────
  const fromScript = await page.evaluate(() => {
    if (typeof qnbankdata === "undefined") return null;
    return Object.values(qnbankdata).map(q => q.rawtitle || "");
  });

  if (fromScript && fromScript.length > 0) {
    return fromScript
      .map((t, i) => `${i + 1}. ${t.trim()}`)
      .filter(q => q.length > 5);
  }

  // ── Strategy 2: DOM scraping ────────────────────────────────
  const fromDom = await page.$$eval(
    ".single_question_container",
    containers => containers.map(el => {
      const num  = (el.querySelector(".qnbank_number")  || {}).innerText || "";
      const body = (el.querySelector(".qnbank_content") || {}).innerText || "";
      return `${num.trim()}. ${body.trim()}`;
    })
  );

  return fromDom.filter(q => q.length > 5);
}

// ── Organize Questions using AI ──────────────────────────

async function organizeQuestions(semNum, semesterWord) {
  const classificationPrompt = `You are a university exam question organizer.

You will be given:
1. A SYLLABUS defining units and topics (numbered like 1.1, 2.3, etc.)
2. A QUESTION BANK containing exam questions from multiple years.

Your task:
- Map EVERY question to the most relevant syllabus unit and topic.
- If a question covers multiple topics, duplicate it under each
  relevant topic.
- Never skip or omit any question.
- Use ONLY units and topics that exist in the syllabus — do not
  invent new ones.

Return ONLY a valid markdown document. No explanation, no preamble,
no text after. No JSON.

The markdown must follow this exact structure:

## Unit 1: <unit_title>

### 1.1 <topic_title>

| Q# | Year | Question | Topic |
|---|---|---|---|
| Q3 | 2081 | Full question text, copied exactly. | 1.1 <topic_title> |

### 1.2 <topic_title>

| Q# | Year | Question | Topic |
|---|---|---|---|

Rules:
- Every unit from the syllabus must appear as a ## heading, even
  if it has no questions.
- Every topic must appear as a ### heading under its unit, even
  if it has no questions. For empty topics show the table headers
  but no data rows.
- Within each topic table, sort rows by year descending (newest
  first). Model sets come last.
- Topic column (last column) must contain the topic code and full topic name. If a topic has multiple comma-separated sub-topics, bold the specific sub-topic(s) that the question targets using **bold** markdown. Example: "1.4 Concurrency: Introduction, Thread States, Writing Multithreaded Programs, Thread Properties, **Thread Synchronization**, Thread Priorities" if the question specifically addresses Thread Synchronization.
- Q# is the original question number from that paper (e.g. Q4, Q11).
- Year is the paper label (e.g. 2081, Model Set II).
- Question text must be copied exactly — do not summarize or shorten.
- Pipe characters | inside question text must be escaped as \\|
- Newlines inside question text must be collapsed to a single space.
- Output only the markdown. No preamble, no explanation, no
  commentary after.

SYLLABUS:
{{SYLLABUS}}

QUESTION BANK:
{{QUESTIONS}}`;

  const QBANK_DIR    = path.join("output", semesterWord, "question-banks");
  const SYLLABUS_DIR = path.join("output", semesterWord, "syllabus");
  const ORG_DIR      = path.join("output", semesterWord, "organized");

  fs.mkdirSync(ORG_DIR, { recursive: true });

  // ── Check question bank directory exists ─────────────────────
  let qbankFiles;
  try {
    qbankFiles = fs.readdirSync(QBANK_DIR).filter(f => f.endsWith(".md"));
  } catch (err) {
    renderLoadingScreen("✖  No question bank directory found: " + QBANK_DIR);
    await new Promise(r => setTimeout(r, 3000));
    process.stdout.write("\x1b[?1049l\x1b[?25h");
    process.exit(1);
  }

  if (!qbankFiles.length) {
    renderLoadingScreen("✖  No .md files found in: " + QBANK_DIR);
    await new Promise(r => setTimeout(r, 3000));
    process.stdout.write("\x1b[?1049l\x1b[?25h");
    process.exit(1);
  }

  // ── TUI subject selection (stdin already in raw mode from config screen) ─
  const subjects = qbankFiles.map(f => ({ slug: f.replace(".md", ""), name: f.replace(".md", "") }));
  const selectedSubjects = await selectSubjects(subjects);

  if (!selectedSubjects.length) {
    process.stdout.write("\x1b[?1049l\x1b[?25h");
    process.exit(0);
  }

  // ── Init organize dashboard ───────────────────────────────────
  for (const { slug } of selectedSubjects) {
    dashState.subjects[slug] = { qbankStatus: "pending", syllabusStatus: null };
  }
  dashState.totalCount = selectedSubjects.length;

  const subjectSlugs = selectedSubjects.map(s => s.slug);
  const onResize = () => renderDashboard(subjectSlugs, semesterWord, "organize");
  process.stdout.on("resize", onResize);
  startDashboard(subjectSlugs, semesterWord, "organize");

  let skipped = 0;
  let processed = 0;

  for (const { slug } of selectedSubjects) {
    const qbankPath    = path.join(QBANK_DIR,    `${slug}.md`);
    const syllabusPath = path.join(SYLLABUS_DIR, `${slug}.md`);

    setSubjectStatus(slug, "qbankStatus", "active");

    if (!fs.existsSync(syllabusPath)) {
      setTask(slug, "Skipped: syllabus not found");
      setSubjectStatus(slug, "qbankStatus", "skipped");
      setSubjectStatus(slug, "error", "no syllabus");
      skipped++; dashState.totalDone++; dashState.activeSlug = null;
      continue;
    }
    if (!fs.existsSync(qbankPath)) {
      setTask(slug, "Skipped: question bank not found");
      setSubjectStatus(slug, "qbankStatus", "skipped");
      setSubjectStatus(slug, "error", "no qbank");
      skipped++; dashState.totalDone++; dashState.activeSlug = null;
      continue;
    }

    try {
      setTask(slug, "Reading files...");
      const syllabusContent  = fs.readFileSync(syllabusPath, "utf8");
      const questionsContent = fs.readFileSync(qbankPath, "utf8");

      const fullPrompt = classificationPrompt
        .replace("{{SYLLABUS}}", syllabusContent)
        .replace("{{QUESTIONS}}", questionsContent);

      setTask(slug, "Mapping Questions to Syllabus Topics...");

      try {
        const result = await execFileAsync("gemini", ["-p", fullPrompt], {
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024
        });
        const stdout = typeof result === "string" ? result : result.stdout;

        const timestamp = new Date().toLocaleString();
        const header = `# ${slug} — Organized by Syllabus Unit\n**Semester:** ${semNum} | **Generated:** ${timestamp}\n\n`;
        fs.writeFileSync(path.join(ORG_DIR, `${slug}.md`), header + stdout, "utf8");
        setSubjectStatus(slug, "qbankStatus", "done");
        processed++;
      } catch (err) {
        setSubjectStatus(slug, "qbankStatus", "error");
        setSubjectStatus(slug, "error", err.message.slice(0, 80));
        console.error(`\nFull error for ${slug}:`, err);
      }
    } catch (err) {
      setSubjectStatus(slug, "qbankStatus", "error");
      setSubjectStatus(slug, "error", err.message.slice(0, 80));
      console.error(`\nFull error for ${slug}:`, err);
    }

    dashState.totalDone++;
    dashState.activeSlug = null;
  }

  stopDashboard();
  dashState.phase      = "done";
  dashState.activeSlug = null;
  dashState.activeTask = "";
  renderDashboard(subjectSlugs, semesterWord, "organize");
  process.stdout.removeListener("resize", onResize);

  await new Promise(resolve => {
    const onData = () => { process.stdin.removeListener("data", onData); resolve(); };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });

  process.stdout.write("\x1b[?1049l\x1b[?25h");
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();

  console.log(chalk.bold.green("\n╭─────────────────────────────────────╮"));
  console.log(chalk.bold.green("│  ORGANIZE COMPLETE                  │"));
  console.log(chalk.bold.green("╰─────────────────────────────────────╯"));
  console.log(`  Processed : ${processed}`);
  console.log(`  Skipped   : ${skipped}`);
  console.log(`  Output    : ${ORG_DIR}/\n`);
}


// ── Main ──────────────────────────────────────────────────────

(async () => {
  // ── Config screen ────────────────────────────────────────────
  const { semester: semNum, modeId } = await runConfigScreen();

  const semesterWord   = SEMESTER_WORDS[semNum];
  const scrapeQBanks   = modeId === "qbanks"   || modeId === "both";
  const scrapeSyllabus = modeId === "syllabus" || modeId === "both";
  const isOrganize     = modeId === "organize";

  const BASE         = `${SITE}/semester/${semesterWord}`;
  const OUT_DIR      = path.join("output", semesterWord);
  const QBANK_DIR    = path.join(OUT_DIR, "question-banks");
  const SYLLABUS_DIR = path.join(OUT_DIR, "syllabus");

  if (isOrganize) {
    // Organize mode: stays fully in TUI, organizeQuestions handles everything
    await organizeQuestions(semNum, semesterWord);
    process.exit(0);
  }

  // ── Show loading screen immediately after config ─────────────
  let loadSpinTimer = null;
  let loadSpinIdx   = 0;
  const updateLoading = (msg) => renderLoadingScreen(SPINNER[loadSpinIdx] + "  " + msg);
  const startLoadingScreen = (msg) => {
    updateLoading(msg);
    loadSpinTimer = setInterval(() => {
      loadSpinIdx = (loadSpinIdx + 1) % SPINNER.length;
      updateLoading(msg);
    }, 80);
  };
  const stopLoadingScreen = () => {
    if (loadSpinTimer) { clearInterval(loadSpinTimer); loadSpinTimer = null; }
  };

  startLoadingScreen("Launching browser...");

  // ── Launch browser ───────────────────────────────────────────
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });

  const page = await context.newPage();

  stopLoadingScreen();
  startLoadingScreen("Connecting to hamrocsit.com...");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 25000 });
  await sleep(2000);

  stopLoadingScreen();
  startLoadingScreen("Discovering subjects...");
  const SUBJECTS = await getSubjects(page, semesterWord);
  stopLoadingScreen();

  if (!SUBJECTS.length) {
    process.stdout.write("\x1b[?1049l\x1b[?25h");
    console.error(chalk.red("\n  ✖ No subjects found. Check the semester URL or site structure."));
    await browser.close();
    process.exit(1);
  }

  // ── TUI subject selection ─────────────────────────────────────
  const selectedSubjects = await selectSubjects(SUBJECTS);

  // ── Init dashboard state ──────────────────────────────────────
  for (const { slug } of selectedSubjects) {
    dashState.subjects[slug] = {
      qbankStatus:   scrapeQBanks   ? "pending" : null,
      syllabusStatus: scrapeSyllabus ? "pending" : null,
    };
  }
  dashState.totalCount = selectedSubjects.length;

  // ── Create output dirs ────────────────────────────────────────
  if (scrapeQBanks)   fs.mkdirSync(QBANK_DIR,    { recursive: true });
  if (scrapeSyllabus) fs.mkdirSync(SYLLABUS_DIR,  { recursive: true });

  const subjectSlugs = selectedSubjects.map(s => s.slug);

  // ── Graceful abort ────────────────────────────────────────────
  const cleanup = async () => {
    stopDashboard();
    process.stdout.write("\x1b[?1049l\x1b[?25h");
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    await browser.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT",  cleanup);
  process.on("SIGTERM", cleanup);

  const onResize = () => renderDashboard(subjectSlugs, semesterWord, modeId);
  process.stdout.on("resize", onResize);

  startDashboard(subjectSlugs, semesterWord, modeId);

  // ── Scrape each subject ──────────────────────────────────────
  for (const { slug, name } of selectedSubjects) {
    setTask(slug, "Starting...");

    // ── Question Banks ──────────────────────────────────────
    if (scrapeQBanks) {
      setSubjectStatus(slug, "qbankStatus", "active");
      setTask(slug, "Fetching question bank index...");

      const qbankLines = [];
      qbankLines.push(`# ${name}`);
      qbankLines.push(`**Semester:** ${semNum} | **Generated:** ${new Date().toLocaleString()}\n`);
      qbankLines.push("## Question Banks\n");
      qbankLines.push("Sorted by year (newest first). Model questions marked with **[MODEL QUESTION]**.\n");

      try {
        const indexUrl = `${BASE}/${slug}/question-bank/`;
        await page.goto(indexUrl, { waitUntil: "networkidle", timeout: 25000 });
        await sleep(DELAY_MS);

        const paperLinks = await getPaperLinks(page, semesterWord, slug);
        let hasQuestions = false;
        let totalQCount  = 0;

        if (!paperLinks.length) {
          qbankLines.push("*No paper links found*\n");
        } else {
          for (const { label, url, year, isModel: model } of paperLinks) {
            const yearDisplay = year || "Model/Unknown";
            const modelTag    = model ? " **[MODEL QUESTION]**" : "";
            setTask(slug, `Scraping ${yearDisplay}...`);

            await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
            await sleep(DELAY_MS);

            const questions = await extractQuestions(page);
            totalQCount += questions.length;

            if (questions.length) {
              hasQuestions = true;
              qbankLines.push(`### Year: ${yearDisplay}${modelTag}`);
              qbankLines.push(`**Label:** ${label}`);
              qbankLines.push(`**URL:** ${url}`);
              qbankLines.push("");
              questions.forEach(q => qbankLines.push(q));
              qbankLines.push("");
            }
          }
        }

        if (hasQuestions) {
          fs.writeFileSync(path.join(QBANK_DIR, `${slug}.md`), qbankLines.join("\n"), "utf8");
          setSubjectStatus(slug, "qbankStatus", "done");
          setSubjectStatus(slug, "qbankCount", totalQCount);
        } else {
          setSubjectStatus(slug, "qbankStatus", "skipped");
        }
      } catch (e) {
        setSubjectStatus(slug, "qbankStatus", "error");
        setSubjectStatus(slug, "error", e.message);
      }
    }

    // ── Syllabus ────────────────────────────────────────────
    if (scrapeSyllabus) {
      setSubjectStatus(slug, "syllabusStatus", "active");
      setTask(slug, "Scraping syllabus...");

      const syllabusLines = [];
      syllabusLines.push(`# ${name}`);
      syllabusLines.push(`**Semester:** ${semNum} | **Generated:** ${new Date().toLocaleString()}\n`);
      syllabusLines.push("## Syllabus\n");

      try {
        const syllabusUrl = `${BASE}/${slug}/syllabus`;
        await page.goto(syllabusUrl, { waitUntil: "networkidle", timeout: 25000 });
        await sleep(DELAY_MS);

        const syllabus = await extractSyllabus(page);
        let hasSyllabusContent = false;

        if (syllabus) {
          if (syllabus.header) {
            syllabus.header.split("\n").filter(l => l.trim()).forEach(l => syllabusLines.push(`> ${l}`));
            syllabusLines.push("");
            hasSyllabusContent = true;
          }
          if (syllabus.courseMetadata) {
            syllabusLines.push("### Course Information\n");
            syllabus.courseMetadata.split("\n").filter(l => l.trim()).forEach(l => {
              if (l.includes(":")) {
                const [k, v] = l.split(":").map(s => s.trim());
                syllabusLines.push(`- **${k}:** ${v}`);
              } else {
                syllabusLines.push(`- ${l}`);
              }
            });
            syllabusLines.push("");
            hasSyllabusContent = true;
          }
          if (syllabus.units && syllabus.units.length) {
            syllabusLines.push("### Course Contents\n");
            for (const unit of syllabus.units) {
              if (unit.title) {
                syllabusLines.push(`#### ${unit.title}\n`);
                if (unit.description) { syllabusLines.push(unit.description); hasSyllabusContent = true; }
                syllabusLines.push("");
              }
            }
          }
          if (syllabus.labWorks)       { syllabusLines.push("### Laboratory Works\n", syllabus.labWorks, ""); hasSyllabusContent = true; }
          if (syllabus.textBooks)      { syllabusLines.push("### Text Books\n");      syllabus.textBooks.split("\n").filter(l=>l.trim()).forEach(l=>syllabusLines.push(`- ${l}`));      syllabusLines.push(""); hasSyllabusContent = true; }
          if (syllabus.referenceBooks) { syllabusLines.push("### Reference Books\n"); syllabus.referenceBooks.split("\n").filter(l=>l.trim()).forEach(l=>syllabusLines.push(`- ${l}`)); syllabusLines.push(""); hasSyllabusContent = true; }
        }

        if (hasSyllabusContent) {
          fs.writeFileSync(path.join(SYLLABUS_DIR, `${slug}.md`), syllabusLines.join("\n"), "utf8");
          setSubjectStatus(slug, "syllabusStatus", "done");
        } else {
          setSubjectStatus(slug, "syllabusStatus", "skipped");
        }
      } catch (e) {
        setSubjectStatus(slug, "syllabusStatus", "error");
        setSubjectStatus(slug, "error", e.message);
      }
    }

    dashState.totalDone++;
    dashState.activeSlug = null;
  }

  await browser.close();
  stopDashboard();

  // ── Final render + wait for keypress ─────────────────────────
  dashState.phase      = "done";
  dashState.activeSlug = null;
  dashState.activeTask = "";
  renderDashboard(subjectSlugs, semesterWord, modeId);

  process.stdout.removeListener("resize", onResize);

  await new Promise(resolve => {
    const onData = () => {
      process.stdin.removeListener("data", onData);
      resolve();
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });

  process.stdout.write("\x1b[?1049l\x1b[?25h");
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();

  // ── Summary ───────────────────────────────────────────────────
  console.log(chalk.bold.green("\n╭─────────────────────────────────────╮"));
  console.log(chalk.bold.green("│  SCRAPE COMPLETE                    │"));
  console.log(chalk.bold.green("╰─────────────────────────────────────╯"));
  if (scrapeQBanks)   console.log(`  Question Banks → ${QBANK_DIR}/`);
  if (scrapeSyllabus) console.log(`  Syllabus       → ${SYLLABUS_DIR}/`);
  console.log();
})();
