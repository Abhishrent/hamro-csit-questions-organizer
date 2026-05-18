// ============================================================
// Hamro CSIT — Question Bank Scraper (any semester)
// ============================================================
// SETUP (one time):
//   npm init -y
//   npm install playwright
//   npx playwright install chromium
//
// RUN:
//   node hamrocsit_scraper.js
//   → prompts: "Enter semester number (1-8):"
//
// OUTPUT:
//   output/<semester-word>/<subject-slug>.txt
//   One file per subject, sorted by year, model questions marked
// ============================================================

const { chromium } = require("playwright");
const fs           = require("fs");
const readline     = require("readline");

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

// ── Prompt helper ─────────────────────────────────────────────
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
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

// ── Main ──────────────────────────────────────────────────────

(async () => {
  // ── Get semester from user ───────────────────────────────────
  let semNum;
  while (true) {
    const input = await prompt("Enter semester number (1-8): ");
    semNum = parseInt(input, 10);
    if (semNum >= 1 && semNum <= 8) break;
    console.log("  Please enter a number between 1 and 8.");
  }

  // ── Ask what to scrape ───────────────────────────────────────
  let scrapeQBanks = false;
  let scrapeSyllabus = false;
  
  while (true) {
    const option = await prompt(
      "\nWhat to scrape?\n" +
      "  1) Question Banks only\n" +
      "  2) Syllabus only\n" +
      "  3) Both Question Banks and Syllabus\n" +
      "  4) Cancel\n" +
      "Enter choice (1-4): "
    );
    
    if (option === "1") {
      scrapeQBanks = true;
      break;
    } else if (option === "2") {
      scrapeSyllabus = true;
      break;
    } else if (option === "3") {
      scrapeQBanks = true;
      scrapeSyllabus = true;
      break;
    } else if (option === "4") {
      console.log("Cancelled.");
      process.exit(0);
    } else {
      console.log("  Invalid choice. Please enter 1, 2, 3, or 4.");
    }
  }

  const semesterWord = SEMESTER_WORDS[semNum];
  const BASE         = `${SITE}/semester/${semesterWord}`;
  const OUT_DIR      = `output/${semesterWord}`;
  const QBANK_DIR    = `${OUT_DIR}/question-banks`;
  const SYLLABUS_DIR = `${OUT_DIR}/syllabus`;

  console.log(`\nScraping semester ${semNum} (${semesterWord})...`);

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

  // ── Create output directories ────────────────────────────────
  if (scrapeQBanks) fs.mkdirSync(QBANK_DIR, { recursive: true });
  if (scrapeSyllabus) fs.mkdirSync(SYLLABUS_DIR, { recursive: true });

  // ── Warm up + discover subjects ──────────────────────────────
  console.log("Warming up session...");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 25000 });
  await sleep(2000);

  const SUBJECTS = await getSubjects(page, semesterWord);
  console.log(`Found ${SUBJECTS.length} subject(s): ${SUBJECTS.map(s => s.slug).join(", ")}`);

  if (!SUBJECTS.length) {
    console.log("No subjects found. Check the semester URL or site structure.");
    await browser.close();
    return;
  }

  // ── Scrape each subject ──────────────────────────────────────
  for (const { slug, name } of SUBJECTS) {
    console.log(`\n${"=".repeat(64)}`);
    console.log(`  [${name}]`);
    console.log("=".repeat(64));

    // ── Scrape Question Banks ────────────────────────────────
    if (scrapeQBanks) {
      const qbankLines = [];
      qbankLines.push(`# ${name}`);
      qbankLines.push(`**Semester:** ${semNum} | **Generated:** ${new Date().toLocaleString()}\n`);
      qbankLines.push("## Question Banks\n");
      qbankLines.push("Sorted by year (newest first). Model questions marked with **[MODEL QUESTION]**.\n");

      const indexUrl = `${BASE}/${slug}/question-bank/`;
      await page.goto(indexUrl, { waitUntil: "networkidle", timeout: 25000 });
      await sleep(DELAY_MS);

      const paperLinks = await getPaperLinks(page, semesterWord, slug);
      console.log(`  Found ${paperLinks.length} question bank paper(s)`);

      if (!paperLinks.length) {
        qbankLines.push("*No paper links found*\n");
      } else {
        for (const { label, url, year, isModel: model } of paperLinks) {
          const yearDisplay = year || "Model/Unknown";
          const modelTag   = model ? " **[MODEL QUESTION]**" : "";
          console.log(`  → ${yearDisplay} ${modelTag}  '${label}'`);

          await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
          await sleep(DELAY_MS);

          const questions = await extractQuestions(page);
          console.log(`    ${questions.length} question(s) extracted`);

          qbankLines.push(`### Year: ${yearDisplay}${modelTag}`);
          qbankLines.push(`**Label:** ${label}`);
          qbankLines.push(`**URL:** ${url}`);
          qbankLines.push("");

          if (questions.length) {
            questions.forEach(q => qbankLines.push(`${q}`));
            qbankLines.push("");
          } else {
            qbankLines.push("*No questions extracted from this page*\n");
          }
        }
      }

      const qbankFile = `${QBANK_DIR}/${slug}.md`;
      fs.writeFileSync(qbankFile, qbankLines.join("\n"), "utf8");
      console.log(`  Saved question bank → ${qbankFile}`);
    }

    // ── Scrape Syllabus ──────────────────────────────────────
    if (scrapeSyllabus) {
      const syllabusLines = [];
      syllabusLines.push(`# ${name}`);
      syllabusLines.push(`**Semester:** ${semNum} | **Generated:** ${new Date().toLocaleString()}\n`);
      syllabusLines.push("## Syllabus\n");

      const syllabusUrl = `${BASE}/${slug}/syllabus`;
      await page.goto(syllabusUrl, { waitUntil: "networkidle", timeout: 25000 });
      await sleep(DELAY_MS);

      const syllabus = await extractSyllabus(page);
      console.log(`  Extracting syllabus content...`);

      if (!syllabus) {
        console.log("  (Syllabus not found on page)");
        syllabusLines.push("*Syllabus content not found*\n");
      } else {
        if (syllabus.header) {
          const headerLines = syllabus.header.split('\n').filter(line => line.trim());
          headerLines.forEach(line => syllabusLines.push(`> ${line}`));
          syllabusLines.push("");
        }

        if (syllabus.courseMetadata) {
          syllabusLines.push("### Course Information\n");
          const metaLines = syllabus.courseMetadata.split('\n').filter(line => line.trim());
          metaLines.forEach(line => {
            if (line.includes(':')) {
              const [key, value] = line.split(':').map(s => s.trim());
              syllabusLines.push(`- **${key}:** ${value}`);
            } else {
              syllabusLines.push(`- ${line}`);
            }
          });
          syllabusLines.push("");
        }

        if (syllabus.units && syllabus.units.length) {
          syllabusLines.push("### Course Contents\n");
          for (const unit of syllabus.units) {
            if (unit.title) {
              syllabusLines.push(`#### ${unit.title}\n`);
              if (unit.description) {
                syllabusLines.push(unit.description);
              }
              syllabusLines.push("");
            }
          }
        }

        if (syllabus.labWorks) {
          syllabusLines.push("### Laboratory Works\n");
          syllabusLines.push(syllabus.labWorks);
          syllabusLines.push("");
        }

        if (syllabus.textBooks) {
          syllabusLines.push("### Text Books\n");
          const bookLines = syllabus.textBooks.split('\n').filter(line => line.trim());
          bookLines.forEach(line => syllabusLines.push(`- ${line}`));
          syllabusLines.push("");
        }

        if (syllabus.referenceBooks) {
          syllabusLines.push("### Reference Books\n");
          const refLines = syllabus.referenceBooks.split('\n').filter(line => line.trim());
          refLines.forEach(line => syllabusLines.push(`- ${line}`));
          syllabusLines.push("");
        }
      }

      const syllabusFile = `${SYLLABUS_DIR}/${slug}.md`;
      fs.writeFileSync(syllabusFile, syllabusLines.join("\n"), "utf8");
      console.log(`  Saved syllabus → ${syllabusFile}`);
    }
  }

  await browser.close();

  console.log(`\n${"=".repeat(64)}`);
  console.log(`Done! Markdown files saved to:`);
  if (scrapeQBanks) console.log(`  Question Banks → ${QBANK_DIR}/`);
  if (scrapeSyllabus) console.log(`  Syllabus → ${SYLLABUS_DIR}/`);
  console.log("=".repeat(64));
})();
