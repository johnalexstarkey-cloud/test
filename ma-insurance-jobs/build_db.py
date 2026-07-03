#!/usr/bin/env python3
"""Build the MA entry-level insurance jobs SQLite database and CSV exports.

Re-run after editing the COMPANIES / JOBS seed data below:
    python3 build_db.py
Produces jobs.db, jobs.csv, and companies.csv in this directory.
"""

import csv
import sqlite3
from pathlib import Path

HERE = Path(__file__).parent
DB_PATH = HERE / "jobs.db"

SCHEMA = """
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS companies;

CREATE TABLE companies (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    company_type TEXT,            -- carrier, broker, life insurer, etc.
    ma_locations TEXT,            -- where they have MA offices
    careers_url TEXT,             -- direct careers page (apply here, not aggregators)
    notes TEXT
);

CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    title TEXT NOT NULL,
    category TEXT,                -- underwriting, operations, program
    location TEXT,
    salary_range TEXT,
    source_type TEXT,             -- 'direct' = employer's own site; 'aggregator-verified' = seen on a job board
    source_url TEXT,
    date_found TEXT,              -- YYYY-MM-DD
    entry_level_fit TEXT,         -- strong / good / stretch
    description TEXT,
    -- application tracking (fill these in as you apply)
    status TEXT DEFAULT 'not_applied',   -- not_applied / applied / interviewing / offer / rejected
    applied_date TEXT,
    follow_up_notes TEXT
);
"""

COMPANIES = [
    # name, type, ma_locations, careers_url, notes
    ("Safety Insurance", "P&C carrier (MA-focused)", "Boston (Financial District)",
     "https://www.safetyinsurance.com/careers/job_postings.html",
     "One of the largest MA private-passenger auto insurers. 37.5-hour workweek, hybrid options, 3 weeks PTO + 14 holidays. Posts jobs only on its own site and a few boards."),
    ("Arbella Insurance Group", "P&C carrier (New England only)", "Quincy (HQ)",
     "https://www.arbella.com/current-openings",
     "MA-based mutual. ~28-39 open roles in Quincy. In-person interview at Quincy HQ required before any offer. Known for promoting from within."),
    ("The Hanover Insurance Group", "P&C carrier (national)", "Worcester (HQ)",
     "https://careers.hanover.com",
     "Fortune 500, HQ in Worcester. Runs Workday portal (hanover.wd5.myworkdayjobs.com). Regularly hires associate underwriters and underwriting associates."),
    ("MAPFRE Insurance", "P&C carrier (largest MA auto insurer)", "Webster (HQ)",
     "https://www.mapfreinsurance.com/careers/",
     "US arm of Spanish insurer; #1 private auto insurer in MA. Talent team: talentacquisition@mapfreusa.com. ~27-41 open US roles."),
    ("Plymouth Rock Assurance", "P&C carrier", "Boston (Seaport/Financial District)",
     "https://www.plymouthrock.com/about/careers",
     "~34 open Boston roles. Hires entry-level classes into claims and underwriting support; check Home Underwriting Dept postings."),
    ("Liberty Mutual", "P&C carrier (global)", "Boston (HQ, Back Bay)",
     "https://jobs.libertymutualgroup.com",
     "Structured early-career underwriting programs (Underwriting Development Program, Surety UDP, campus internships). Best pipeline for new grads."),
    ("Berkshire Hathaway Specialty Insurance", "Commercial/specialty carrier", "Boston (HQ)",
     "https://www.bhspecialty.com/career-jobs/",
     "HQ in Boston; lists all jobs on its own site by region (bhspecialty.com/career_category/boston/). Underwriting Technician roles are the entry path."),
    ("Quincy Mutual Group", "P&C carrier (mutual)", "Quincy",
     "https://www.quincymutual.com/open-positions.htm",
     "Small MA mutual; jobs posted on a plain HTML page rarely syndicated to aggregators - exactly the hidden-market type. Underwriting Account/Client Specialist ladder is the entry path."),
    ("The Travelers Companies", "P&C carrier (national)", "Boston + MA field offices",
     "https://careers.travelers.com/job-search-results/",
     "Underwriting Professional Development Program (UPDP) is a classic new-grad underwriting track; multiple 2026 cohorts. Confirm MA placement per posting."),
    ("MassMutual", "Life insurer", "Springfield (HQ), Boston (Seaport)",
     "https://careers.massmutual.com/search-jobs",
     "~71 Springfield openings incl. Operations Associate roles; life/disability underwriting support jobs appear regularly."),
    ("Boston Mutual Life Insurance", "Life insurer", "Canton (HQ)",
     "https://www.bostonmutual.com/about-us/employment-opportunities/",
     "Small MA life insurer (~9 openings at last check); jobs on own site, lightly syndicated."),
    ("SBLI (Savings Bank Mutual Life)", "Life insurer", "Woburn (HQ)",
     "https://www.sbli.com/about-us/careers",
     "Small MA life insurer (~4 openings); life underwriting operations roles appear here first."),
    ("Coverys", "Medical professional liability carrier", "Boston (HQ)",
     "https://www.coverys.com/careers",
     "Boston-based med-mal insurer; underwriting assistant/analyst roles post on own site."),
    ("A.I.M. Mutual", "Workers' compensation carrier", "Burlington (HQ)",
     "https://www.aimmutual.com/careers",
     "MA workers' comp specialist; small shop, jobs rarely hit aggregators."),
    ("Norfolk & Dedham Group", "P&C carrier (mutual)", "Dedham (HQ)",
     "https://www.ndgroup.com",
     "MA mutual; check Careers page directly - postings rarely syndicated."),
    ("The Andover Companies", "P&C carrier (mutual)", "Andover (HQ)",
     "https://www.andovercompanies.com/careers",
     "Merrimack Mutual group. Known internship-to-hire pipeline; watch for underwriting trainee roles."),
    ("Cross Insurance", "Broker/agency (2nd largest in MA)", "Beverly, Boston + statewide branches",
     "https://www.crossagency.com/careers/",
     "1,200+ employees; posts openings on Workday via own careers page. Commercial Lines Assistant is the entry path on the agency side."),
    ("HUB International New England", "Broker/agency", "Wilmington, Boston + branches",
     "https://careers.hubinternational.com/us/en/c/account-management-jobs",
     "Large broker; account coordinator / customer service roles are entry doors into underwriting-adjacent work."),
    ("John Hancock", "Life insurer (Manulife)", "Boston (Seaport)",
     "https://careers.manulife.com",
     "Life underwriting + operations roles post under Manulife/John Hancock careers; check Boston-filtered search."),
    ("Sun Life U.S.", "Group benefits insurer", "Wellesley (US HQ)",
     "https://sunlife.wd3.myworkdayjobs.com/Experienced-Jobs",
     "Group benefits underwriting associate roles appear for Wellesley; also remote-eligible ops roles."),
]

# date_found is the research date (2026-07-03); verify each posting is still open before applying.
JOBS = [
    # company, title, category, location, salary, source_type, source_url, fit, description
    ("Safety Insurance", "Associate Commercial Underwriter", "underwriting", "Boston, MA",
     "$53,000-$67,000", "direct",
     "https://www.safetyinsurance.com/careers/job_postings.html", "strong",
     "Reviews, evaluates and processes new and renewal business submissions for commercial underwriters. Hybrid, 37.5-hr week, downtown Boston."),
    ("Safety Insurance", "Operations Associate", "operations", "Boston, MA",
     "~$52K-$63K (est.)", "direct",
     "https://www.safetyinsurance.com/careers/job_postings.html", "strong",
     "Processes insurance policy transactions, customer service, collaborates with internal teams."),
    ("Arbella Insurance Group", "Commercial Lines Associate Underwriter", "underwriting", "Quincy, MA",
     "not posted", "direct",
     "https://www.arbella.com/current-openings", "strong",
     "Handles requests from agents/internal customers; assists underwriters with more sophisticated underwriting functions. Also on LinkedIn."),
    ("Arbella Insurance Group", "Commercial Lines Operations Associate", "operations", "Quincy, MA",
     "not posted", "direct",
     "https://www.arbella.com/current-openings", "strong",
     "Timely/accurate processing of commercial policy transactions within a single line of business."),
    ("The Hanover Insurance Group", "Associate Underwriter, Hanover Specialty Industrial", "underwriting", "Worcester, MA",
     "not posted", "direct",
     "https://careers.hanover.com", "strong",
     "Specialty industrial associate underwriter; posting seen on LinkedIn, apply via Hanover Workday portal."),
    ("The Hanover Insurance Group", "Personal Lines Associate Underwriter", "underwriting", "Worcester, MA",
     "not posted", "direct",
     "https://careers.hanover.com", "strong",
     "Entry personal-lines underwriting role at Worcester HQ."),
    ("The Hanover Insurance Group", "Marine Underwriting Associate", "underwriting", "Worcester, MA",
     "not posted", "direct",
     "https://careers.hanover.com", "good",
     "Underwriting associate supporting marine line; appears periodically at Worcester HQ."),
    ("MAPFRE Insurance", "Operational Support Services Representative", "operations", "Webster, MA",
     "$21.50-$23.50/hr", "direct",
     "https://www.mapfreinsurance.com/careers/", "strong",
     "Reviews, verifies, processes incoming insurance documentation supporting all areas of Insurance Operations. 90-day on-site training, then advancement."),
    ("MAPFRE Insurance", "Commercial Lines Underwriting Assistant", "underwriting", "Webster, MA",
     "not posted", "direct",
     "https://www.mapfreinsurance.com/careers/", "strong",
     "Supports underwriting team gathering/evaluating/analyzing risk info from applications and inspections. Insurance experience preferred but not required."),
    ("Liberty Mutual", "Underwriting Development Program - Global Risk Solutions (June 2026)", "program", "Boston, MA",
     "not posted (UDP roles typically $60K+)", "direct",
     "https://jobs.libertymutualgroup.com", "strong",
     "Structured new-grad underwriting program; ~6-month curriculum then a desk under experienced underwriters."),
    ("Liberty Mutual", "Associate Surety Underwriter - Surety Underwriting Development Program", "program", "Multiple locations (confirm Boston)",
     "$47,000-$123,000 band", "direct",
     "https://jobs.libertymutualgroup.com", "good",
     "15-month development program: structured mentoring, rotations across product lines. 2026 starts June/July."),
    ("Liberty Mutual", "Underwriting Internship Program - Commercial Lines (Summer 2026)", "program", "Boston, MA",
     "$24.50-$26.50/hr", "direct",
     "https://jobs.libertymutualgroup.com/careers/campus/undergraduate-internships/underwriting/", "good",
     "Paid summer internship; common feeder into the full-time UDP."),
    ("Berkshire Hathaway Specialty Insurance", "Underwriting Technician, Transactional Liability", "underwriting", "Boston, MA",
     "not posted", "direct",
     "https://www.bhspecialty.com/career_category/boston/", "good",
     "Underwriting Technician is BHSI's entry rung; supports transactional liability underwriters at Boston HQ."),
    ("Quincy Mutual Group", "Underwriting Account Specialist I", "underwriting", "Quincy, MA",
     "not posted", "direct",
     "https://www.quincymutual.com/open-positions.htm", "strong",
     "Administrative + technical support to underwriting team; assists with evaluating and processing commercial P&C transactions. Plain-HTML careers page, rarely on aggregators."),
    ("Quincy Mutual Group", "Underwriting Client Specialist", "underwriting", "Quincy, MA",
     "not posted", "direct",
     "https://www.quincymutual.com/open-positions.htm", "strong",
     "Entry-level underwriting responsibilities; facilitates communication between clients and underwriters."),
    ("The Travelers Companies", "Underwriting Professional Development Program - Commercial Accounts (Feb 2026 cohort; watch for next)", "program", "Various (confirm MA office)",
     "$59,200-$97,700", "aggregator-verified",
     "https://careers.travelers.com/job-search-results/", "good",
     "Classic new-grad underwriting track; first-year structured training in underwriting philosophy, negotiation, relationship building. Multiple 2026 cohorts (Feb/June); verify MA placement."),
    ("MassMutual", "Operations Associate", "operations", "Springfield, MA",
     "not posted", "direct",
     "https://careers.massmutual.com/search-jobs", "strong",
     "Life-insurance operations: reviewing/preparing work orders for rating and issuing policies, applying screening criteria, obtaining underwriting info from customers."),
    ("Cross Insurance", "Commercial Lines Assistant", "operations", "Beverly, MA",
     "not posted", "direct",
     "https://www.crossagency.com/careers/", "strong",
     "Agency-side entry role supporting commercial account managers; prioritization, detail, problem-solving. 2nd largest broker in MA."),
    ("HUB International New England", "Account Coordinator / CS support (underwriting services)", "operations", "Boston area / Wilmington, MA",
     "not posted", "direct",
     "https://careers.hubinternational.com/us/en/c/account-management-jobs", "good",
     "Entry account-management roles spanning claims, client oversight and underwriting services support."),
    ("Plymouth Rock Assurance", "Underwriting dept openings (e.g., QA Analyst, Home Underwriting; entry claims classes)", "underwriting", "Boston, MA",
     "not posted (UW median ~$88K at PR)", "direct",
     "https://www.plymouthrock.com/about/careers", "good",
     "~34 Boston openings; recruits energetic entry-level candidates into claims and underwriting support. Check careers page for current underwriting-support reqs."),
]


def main() -> None:
    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA)
    con.executemany(
        "INSERT INTO companies (name, company_type, ma_locations, careers_url, notes) VALUES (?,?,?,?,?)",
        COMPANIES,
    )
    ids = {name: cid for cid, name in con.execute("SELECT id, name FROM companies")}
    con.executemany(
        """INSERT INTO jobs (company_id, title, category, location, salary_range,
                             source_type, source_url, date_found, entry_level_fit, description)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        [(ids[c], t, cat, loc, sal, st, url, "2026-07-03", fit, desc)
         for c, t, cat, loc, sal, st, url, fit, desc in JOBS],
    )
    con.commit()

    for table, out in (("jobs_export", "jobs.csv"), ("companies", "companies.csv")):
        if table == "jobs_export":
            cur = con.execute(
                """SELECT j.id, c.name AS company, j.title, j.category, j.location,
                          j.salary_range, j.source_type, j.source_url, c.careers_url,
                          j.date_found, j.entry_level_fit, j.description, j.status
                   FROM jobs j JOIN companies c ON c.id = j.company_id
                   ORDER BY j.entry_level_fit, c.name"""
            )
        else:
            cur = con.execute("SELECT * FROM companies ORDER BY name")
        with open(HERE / out, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow([d[0] for d in cur.description])
            w.writerows(cur)

    n_jobs = con.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
    n_cos = con.execute("SELECT COUNT(*) FROM companies").fetchone()[0]
    print(f"Built {DB_PATH.name}: {n_jobs} jobs across {n_cos} companies; exported jobs.csv + companies.csv")
    con.close()


if __name__ == "__main__":
    main()
