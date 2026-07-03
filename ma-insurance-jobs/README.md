# MA Entry-Level Insurance Jobs Database

A SQLite database of entry-level **insurance underwriting and operations** jobs in
Massachusetts, researched **2026-07-03**, with a deliberate focus on roles posted on
**employers' own career pages** rather than aggregators like ZipRecruiter or Indeed.

## Files

| File | What it is |
|---|---|
| `jobs.db` | SQLite database (tables: `companies`, `jobs`) |
| `jobs.csv` | Flat export of all job leads (open in Excel/Sheets) |
| `companies.csv` | The 20 employers with direct careers URLs and notes |
| `build_db.py` | Seed script — edit the data in it and re-run `python3 build_db.py` to rebuild everything |

## Using it

```bash
# browse everything
sqlite3 jobs.db "SELECT company, title, location, salary_range FROM jobs JOIN companies ON companies.id = jobs.company_id;"

# strongest entry-level fits first
sqlite3 jobs.db "SELECT c.name, j.title, j.source_url FROM jobs j JOIN companies c ON c.id=j.company_id WHERE j.entry_level_fit='strong';"

# track your applications
sqlite3 jobs.db "UPDATE jobs SET status='applied', applied_date='2026-07-05' WHERE id=1;"
```

The `jobs` table has tracking columns (`status`, `applied_date`, `follow_up_notes`) so it
doubles as an application tracker.

## The "hidden market" angle

The best-value targets here are small MA mutuals whose postings rarely reach aggregators —
check these career pages directly every week or two:

- **Quincy Mutual** — plain HTML openings page: quincymutual.com/open-positions.htm
- **Norfolk & Dedham Group** (Dedham), **A.I.M. Mutual** (Burlington, workers' comp),
  **The Andover Companies** (Andover), **Boston Mutual** (Canton), **SBLI** (Woburn),
  **Coverys** (Boston)
- **Berkshire Hathaway Specialty** lists everything only on bhspecialty.com by region
- **Safety Insurance** and **Arbella** post on their own sites first

Structured new-grad pipelines (Liberty Mutual UDP, Travelers UPDP) open cohorts on a
schedule (Feb/June starts) — apply early in the prior fall.

> Listings were verified via web research on 2026-07-03; postings close fast, so confirm
> each one is still open on the employer's site before applying.
