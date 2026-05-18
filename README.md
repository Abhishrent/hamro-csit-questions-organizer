# Hamro CSIT Question Bank Scraper

A Node.js tool to scrape, organize, and intelligently categorize exam questions and syllabi from [hamrocsit.com](https://hamrocsit.com) using web automation and AI.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
- [Output Structure](#output-structure)
- [Configuration](#configuration)
- [How It Works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Performance Notes](#performance-notes)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

## Features

- **Web Scraping**: Automatically fetch question banks and syllabi for any semester (1-8)
- **Question Extraction**: Extract exam questions from multiple years with automatic year detection
- **Syllabus Parsing**: Extract course metadata, units, topics, lab works, and textbooks
- **AI Organization**: Use Gemini AI to automatically map questions to syllabus units and topics
- **Markdown Output**: Generate well-formatted markdown files organized by semester and subject

## Prerequisites

- Node.js (v18+)
- npm
- Playwright (installed via npm)
- Gemini CLI (for AI organization feature)

## Installation

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/yourusername/hamro-csit-question-bank-scraper.git
cd hamro-csit-question-bank-scraper
npm install
```

### 2. Install Chromium (one-time)

```bash
npx playwright install chromium
```

### 3. Install Gemini CLI (for option 4)

```bash
# For macOS:
brew install gemini-cli

# For Linux (using apt):
sudo apt install gemini-cli

# Or follow: https://geminicli.com/
```

## Usage

### Running the Script

```bash
node start-scraping.js
```

The script will prompt you for:

1. **Semester number** (1-8)
2. **What to scrape**:
   - **Option 1**: Question Banks only
   - **Option 2**: Syllabus only
   - **Option 3**: Both Question Banks and Syllabus
   - **Option 4**: Organize Questions (requires existing question banks and syllabi)
   - **Option 5**: Cancel

### Example: Scrape Semester 7

```bash
$ node start-scraping.js
Enter semester number (1-8): 7

What to scrape?
  1) Question Banks only
  2) Syllabus only
  3) Both Question Banks and Syllabus
  4) Organize Questions (uses already-scraped files)
  5) Cancel
Enter choice (1-5): 3

Scraping semester 7 (seventh)...
Found 10 subject(s): advanced-java, data-mining, database-administrator, ...
```

### Option 4: Organize Questions with AI

After scraping question banks and syllabi, use option 4 to organize questions by topic:

```bash
Enter choice (1-5): 4

Found 10 subject(s) to organize.

  Processing [advanced-java]...
    Calling Gemini CLI...
    ✓ Saved → output/seventh/organized/advanced-java.md

  Processing [database-administrator]...
    Calling Gemini CLI...
    ✓ Saved → output/seventh/organized/database-administrator.md

Organization complete:
  Processed: 10
  Skipped: 0
  Output directory: output/seventh/organized/
```

## Output Structure

```
output/
├── seventh/
│   ├── question-banks/
│   │   ├── advanced-java.md
│   │   ├── data-mining.md
│   │   └── ...
│   ├── syllabus/
│   │   ├── advanced-java.md
│   │   ├── data-mining.md
│   │   └── ...
│   └── organized/
│       ├── advanced-java.md
│       ├── data-mining.md
│       └── ...
```

### Question Bank Format (raw)

```markdown
# software-project-management
**Semester:** 7 | **Generated:** 5/18/2026, 2:25:21 PM

## Question Banks

Sorted by year (newest first). Model questions marked with **[MODEL QUESTION]**.

### Year: 2081
**Label:** SPM Question Bank 2081
**URL:** https://hamrocsit.com/semester/seventh/software-project-management/question-bank/2081

1. Why do you think economic analysis is an important activity?
2. What are testing principles? List different test strategies.
...
```

### Syllabus Format

```markdown
# software-project-management
**Semester:** 7 | **Generated:** 5/18/2026, 2:25:38 PM

## Syllabus

### Course Information

- **Course Title:** Software Project Management
- **Course no:** CSC415
- **Full Marks:** 60+20+20

### Course Contents

#### Unit 1. Introduction to Software Project Management
5 Hrs.

Software engineering problem and software product...

#### Unit 2. Project Analysis
8 Hrs.
...
```

### Organized Format (AI-generated)

```markdown
# advanced-java — Organized by Syllabus Unit
**Semester:** 7 | **Generated:** 5/18/2026, 3:05:25 PM

## Unit 1: Introduction to Java and OOP

### 1.1 Java Fundamentals

| Q# | Year | Question | Topic |
|---|---|---|---|
| Q1 | 2081 | Explain the difference between OOP and procedural programming. | 1.1 Java Fundamentals |
| Q2 | 2080 | What is the purpose of the JVM? | 1.1 Java Fundamentals |

### 1.2 Inheritance and Polymorphism

| Q# | Year | Question | Topic |
|---|---|---|---|
| Q5 | 2081 | Define inheritance and give an example in Java. | 1.2 Inheritance and Polymorphism |

## Unit 2: Advanced Concepts

### 2.1 Exception Handling

| Q# | Year | Question | Topic |
|---|---|---|---|
| Q3 | 2080 | What is the difference between checked and unchecked exceptions? | 2.1 Exception Handling |
```

## Configuration

### Environment Variables

None required for basic scraping. For AI organization:
- Gemini CLI is used directly (no API key configuration needed if you're logged in)

## How It Works

### 1. Question Bank Scraping

- Fetches semester index page to discover subjects
- For each subject, finds all question paper links
- Extracts questions using embedded JavaScript data (`qnbankdata` object)
- Falls back to DOM scraping if script data unavailable
- Sorts by year (newest first) and marks model questions

### 2. Syllabus Scraping

- Parses syllabus container structure
- Extracts course metadata, units, topics, lab works, and references
- Formats as markdown with hierarchical sections

### 3. AI Organization (Option 4)

- Reads question bank and syllabus markdown files
- Sends both to Gemini AI with detailed instructions
- Gemini maps each question to the most relevant syllabus topic
- Generates markdown table with questions organized by unit and topic
- Handles duplicates for multi-topic questions

## Troubleshooting

### "No subjects found"
- Check internet connection
- Verify the semester number is valid (1-8)
- Confirm hamrocsit.com is accessible

### Option 4 produces empty files
- Ensure question-banks and syllabus directories exist
- Verify Gemini CLI is installed and configured
- Check that files match naming conventions

### Playwright timeout errors
- Increase `waitUntil: "networkidle"` timeout in the script
- Check internet connection speed
- Try running during off-peak hours

## Performance Notes

- **Initial warm-up**: ~2-5 seconds per semester
- **Per subject**: ~1-2 minutes (depends on number of papers)
- **Full semester**: ~15-30 minutes
- **AI Organization**: 2-5 minutes per subject (depends on Gemini API latency)

## Limitations

- Depends on hamrocsit.com structure (changes may break scraping)
- Requires stable internet connection
- AI organization quality depends on question clarity and syllabus detail
- Limited by Gemini free tier rate limits

## Contributing

Improvements welcome! Common enhancement areas:
- Support for additional semesters or sites
- Export to other formats (JSON, CSV)
- Caching to avoid re-scraping
- Better error recovery

## License

MIT

## Support

For issues or questions:
- Check the troubleshooting section above
- Review the script comments for implementation details
- Verify hamrocsit.com accessibility
- Ensure all dependencies are properly installed
