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
const path         = require("path");
const os           = require("os");
const { execSync } = require("child_process");
const inquirer     = require("inquirer").default;

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

// ── Multi-select subjects helper ──────────────────────────────
async function selectSubjects(subjects) {
  if (subjects.length === 0) return [];
  
  const choices = subjects.map(s => ({
    name: s.slug,
    value: s.slug,
    checked: true  // All checked by default
  }));

  const answers = await inquirer.prompt([
    {
      type: "checkbox",
      name: "selected",
      message: "Select subjects to process:",
      choices: choices,
      pageSize: subjects.length + 1,
      searchable: false,
      highlight: true
    }
  ]);

  if (answers.selected.length === 0) {
    console.log("No subjects selected. Cancelling.");
    process.exit(0);
  }

  // Map selected slugs back to subject objects
  return subjects.filter(s => answers.selected.includes(s.slug));
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

// ── Organize Questions using AI ──────────────────────────────

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

  // Create output directory if it doesn't exist
  fs.mkdirSync(ORG_DIR, { recursive: true });

  // Get all question bank files
  let qbankFiles;
  try {
    qbankFiles = fs.readdirSync(QBANK_DIR).filter(f => f.endsWith(".md"));
  } catch (err) {
    console.log(`Error: Could not read question bank directory (${QBANK_DIR})`);
    return;
  }

  if (!qbankFiles.length) {
    console.log(`No question bank files found in ${QBANK_DIR}`);
    return;
  }

  console.log(`Found ${qbankFiles.length} subject(s).`);

  // ── Let user select which subjects to organize ───────────────
  const subjects = qbankFiles.map(f => ({ slug: f.replace(".md", ""), name: f.replace(".md", "") }));
  const selectedSubjects = await selectSubjects(subjects);
  
  if (!selectedSubjects.length) {
    console.log("No subjects selected. Cancelling.");
    return;
  }

  console.log(`Organizing ${selectedSubjects.length} subject(s).`);

  let skipped = 0;
  let processed = 0;

  for (const { slug } of selectedSubjects) {
    const qbankFile = `${slug}.md`;
    const qbankPath = path.join(QBANK_DIR, qbankFile);
    const syllabusPath = path.join(SYLLABUS_DIR, `${slug}.md`);

    // Check if both files exist
    if (!fs.existsSync(syllabusPath)) {
      console.log(`  ⚠  [${slug}] Skipped: syllabus file not found at ${syllabusPath}`);
      skipped++;
      continue;
    }

    if (!fs.existsSync(qbankPath)) {
      console.log(`  ⚠  [${slug}] Skipped: question bank file not found at ${qbankPath}`);
      skipped++;
      continue;
    }

    console.log(`\n  Processing [${slug}]...`);

    try {
      // Read both files
      const syllabusContent = fs.readFileSync(syllabusPath, "utf8");
      const questionsContent = fs.readFileSync(qbankPath, "utf8");

      // Prepare the prompt
      const fullPrompt = classificationPrompt
        .replace("{{SYLLABUS}}", syllabusContent)
        .replace("{{QUESTIONS}}", questionsContent);

      // Call Gemini CLI
      console.log(`    Calling Gemini CLI...`);
      
      // Write prompt to temporary file
      const tmpFile = path.join(os.tmpdir(), `gemini_prompt_${slug}_${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, fullPrompt, "utf8");
      
      try {
        // Call gemini CLI with the prompt file content via stdin
        const promptContent = fs.readFileSync(tmpFile, "utf8");
        const result = execSync(`gemini -p ""`, {
          input: promptContent,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024
        });
        
        // Clean up temp file
        fs.unlinkSync(tmpFile);

        // Prepare output with header
        const timestamp = new Date().toLocaleString();
        const header = `# ${slug} — Organized by Syllabus Unit\n**Semester:** ${semNum} | **Generated:** ${timestamp}\n\n`;
        const output = header + result;

        // Write output file
        const outputPath = path.join(ORG_DIR, `${slug}.md`);
        fs.writeFileSync(outputPath, output, "utf8");
        console.log(`    ✓ Saved → ${outputPath}`);
        processed++;
      } catch (err) {
        // Clean up temp file if it still exists
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        console.log(`    ✗ Error processing [${slug}]: ${err.message}`);
      }
    } catch (err) {
      console.log(`    ✗ Error processing [${slug}]: ${err.message}`);
    }
  }

  console.log(`\n${"=".repeat(64)}`);
  console.log(`Organization complete:`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Output directory: ${ORG_DIR}/`);
  console.log("=".repeat(64));
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
      "  4) Organize Questions (uses already-scraped files)\n" +
      "  5) Cancel\n" +
      "Enter choice (1-5): "
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
      // Organize Questions mode
      const semesterWord = SEMESTER_WORDS[semNum];
      await organizeQuestions(semNum, semesterWord);
      console.log("Done!");
      process.exit(0);
    } else if (option === "5") {
      console.log("Cancelled.");
      process.exit(0);
    } else {
      console.log("  Invalid choice. Please enter 1, 2, 3, 4, or 5.");
    }
  }

  const semesterWord = SEMESTER_WORDS[semNum];
  const BASE         = `${SITE}/semester/${semesterWord}`;
  const OUT_DIR      = path.join("output", semesterWord);
  const QBANK_DIR    = path.join(OUT_DIR, "question-banks");
  const SYLLABUS_DIR = path.join(OUT_DIR, "syllabus");

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

  // ── Let user select which subjects to scrape ─────────────────
  const selectedSubjects = await selectSubjects(SUBJECTS);
  
  if (!selectedSubjects.length) {
    console.log("No subjects selected. Cancelling.");
    await browser.close();
    return;
  }

  // ── Scrape each subject ──────────────────────────────────────
  for (const { slug, name } of selectedSubjects) {
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

      let hasQuestions = false;

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

          if (questions.length) {
            hasQuestions = true;
            qbankLines.push(`### Year: ${yearDisplay}${modelTag}`);
            qbankLines.push(`**Label:** ${label}`);
            qbankLines.push(`**URL:** ${url}`);
            qbankLines.push("");
            questions.forEach(q => qbankLines.push(`${q}`));
            qbankLines.push("");
          }
        }
      }

      // ── Only write file if there's actual content ────────────
      if (hasQuestions) {
        const qbankFile = `${QBANK_DIR}/${slug}.md`;
        fs.writeFileSync(qbankFile, qbankLines.join("\n"), "utf8");
        console.log(`  ✓ Saved question bank → ${qbankFile}`);
      } else {
        console.log(`  ✗ Skipped: no questions extracted for ${slug}`);
      }
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

      let hasSyllabusContent = false;

      if (!syllabus) {
        console.log("  (Syllabus not found on page)");
      } else {
        if (syllabus.header) {
          const headerLines = syllabus.header.split('\n').filter(line => line.trim());
          headerLines.forEach(line => syllabusLines.push(`> ${line}`));
          syllabusLines.push("");
          hasSyllabusContent = true;
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
          hasSyllabusContent = true;
        }

        if (syllabus.units && syllabus.units.length) {
          syllabusLines.push("### Course Contents\n");
          for (const unit of syllabus.units) {
            if (unit.title) {
              syllabusLines.push(`#### ${unit.title}\n`);
              if (unit.description) {
                syllabusLines.push(unit.description);
                hasSyllabusContent = true;
              }
              syllabusLines.push("");
            }
          }
        }

        if (syllabus.labWorks) {
          syllabusLines.push("### Laboratory Works\n");
          syllabusLines.push(syllabus.labWorks);
          syllabusLines.push("");
          hasSyllabusContent = true;
        }

        if (syllabus.textBooks) {
          syllabusLines.push("### Text Books\n");
          const bookLines = syllabus.textBooks.split('\n').filter(line => line.trim());
          bookLines.forEach(line => syllabusLines.push(`- ${line}`));
          syllabusLines.push("");
          hasSyllabusContent = true;
        }

        if (syllabus.referenceBooks) {
          syllabusLines.push("### Reference Books\n");
          const refLines = syllabus.referenceBooks.split('\n').filter(line => line.trim());
          refLines.forEach(line => syllabusLines.push(`- ${line}`));
          syllabusLines.push("");
          hasSyllabusContent = true;
        }
      }

      // ── Only write file if there's actual content ────────────
      if (hasSyllabusContent) {
        const syllabusFile = `${SYLLABUS_DIR}/${slug}.md`;
        fs.writeFileSync(syllabusFile, syllabusLines.join("\n"), "utf8");
        console.log(`  ✓ Saved syllabus → ${syllabusFile}`);
      } else {
        console.log(`  ✗ Skipped: no syllabus content extracted for ${slug}`);
      }
    }
  }

  await browser.close();

  console.log(`\n${"=".repeat(64)}`);
  console.log(`Done! Markdown files saved to:`);
  if (scrapeQBanks) console.log(`  Question Banks → ${QBANK_DIR}/`);
  if (scrapeSyllabus) console.log(`  Syllabus → ${SYLLABUS_DIR}/`);
  console.log("=".repeat(64));
})();
