#!/usr/bin/env node
/**
 * Notion → Lift Migration Script
 *
 * One-time script to import workout data from Notion CSV exports into Lift.
 *
 * Usage:
 *   1. In Notion, go to the "Sets" database → ••• menu → Export → CSV
 *   2. Repeat for the "Exercise Library" database
 *   3. Run this script:
 *
 *      node scripts/import-notion.js \
 *        --sets path/to/Sets.csv \
 *        --exercises path/to/Exercise_Library.csv \
 *        --user-id <your-supabase-user-id>
 *
 *   4. Review the generated files in scripts/output/:
 *      - import-data.sql  → run in Supabase SQL Editor
 *      - import-data.json → paste into localStorage key 'workout-exercises' (optional)
 *
 *   5. After running the SQL, clear localStorage in your browser and reload the app.
 *
 * SAFETY: All SQL is scoped to the provided --user-id. Other users are not affected.
 *         Existing data for that user is deleted before inserting (clears test data).
 *         The SQL is wrapped in a transaction — all-or-nothing.
 */

const { readFileSync, writeFileSync, mkdirSync } = require('fs')
const { randomUUID } = require('crypto')

// ── Argument parsing ─────────────────────────────────────────────
const args = process.argv.slice(2)
function getArg(name) {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null
}

const setsPath = getArg('sets')
const exercisesPath = getArg('exercises')
const userId = getArg('user-id')

if (!setsPath || !exercisesPath || !userId) {
  console.error(`
Usage: node scripts/import-notion.js \\
  --sets <path-to-Sets.csv> \\
  --exercises <path-to-Exercise-Library.csv> \\
  --user-id <supabase-user-id>
`)
  process.exit(1)
}

// ── CSV parser (handles quoted fields with commas/newlines) ──────
function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        row.push(field.trim())
        field = ''
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        row.push(field.trim())
        if (row.length > 1 || row[0] !== '') rows.push(row)
        row = []
        field = ''
        if (ch === '\r') i++
      } else {
        field += ch
      }
    }
  }
  // Last field/row
  row.push(field.trim())
  if (row.length > 1 || row[0] !== '') rows.push(row)

  const headers = rows[0]
  return rows.slice(1).map(r => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = r[i] || '' })
    return obj
  })
}

// ── Read and parse CSVs ──────────────────────────────────────────
console.log('Reading CSVs...')
const setsRaw = readFileSync(setsPath, 'utf-8')
const exercisesRaw = readFileSync(exercisesPath, 'utf-8')

const setsRows = parseCSV(setsRaw)
const exerciseRows = parseCSV(exercisesRaw)

console.log(`  Sets CSV: ${setsRows.length} rows`)
console.log(`  Exercise Library CSV: ${exerciseRows.length} rows`)

// ── Build exercise name → tags map from Exercise Library ─────────
const exerciseTagMap = {}
for (const row of exerciseRows) {
  const name = row['Name'] || ''
  if (!name) continue
  const muscles = (row['Muscles Trained'] || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  exerciseTagMap[name] = muscles
}

console.log(`  Mapped ${Object.keys(exerciseTagMap).length} exercises with tags`)

// ── Build exercises and sets ─────────────────────────────────────
const exerciseMap = {} // name → { id, name, tags, sets[] }

for (const row of setsRows) {
  const exerciseName = row['Exercise'] || row['Workout'] || ''
  if (!exerciseName) continue

  const weight = parseFloat(row['Weight'])
  const reps = parseInt(row['Reps'], 10)
  const dateStr = row['Date'] || ''

  if (isNaN(weight) || isNaN(reps) || !dateStr) {
    console.warn(`  Skipping row: missing weight/reps/date for "${exerciseName}"`)
    continue
  }

  // Parse date — Notion exports as "YYYY-MM-DD" or "Month DD, YYYY" etc.
  let date
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    date = dateStr.slice(0, 10)
  } else {
    const parsed = new Date(dateStr)
    if (isNaN(parsed.getTime())) {
      console.warn(`  Skipping row: unparseable date "${dateStr}" for "${exerciseName}"`)
      continue
    }
    const y = parsed.getFullYear()
    const m = String(parsed.getMonth() + 1).padStart(2, '0')
    const d = String(parsed.getDate()).padStart(2, '0')
    date = `${y}-${m}-${d}`
  }

  // Epley 1RM
  const estimated1RM = reps === 1
    ? Math.round(weight)
    : Math.round(weight * (1 + reps / 30))

  if (!exerciseMap[exerciseName]) {
    exerciseMap[exerciseName] = {
      id: randomUUID(),
      name: exerciseName,
      tags: exerciseTagMap[exerciseName] || [],
      sets: [],
    }
  }

  exerciseMap[exerciseName].sets.push({
    id: randomUUID(),
    date: new Date(date + 'T12:00:00').toISOString(),
    weight,
    reps,
    estimated1RM,
  })
}

const exercises = Object.values(exerciseMap)

// Sort sets by date (oldest first) within each exercise
for (const ex of exercises) {
  ex.sets.sort((a, b) => new Date(a.date) - new Date(b.date))
}

console.log(`\nProcessed:`)
console.log(`  ${exercises.length} exercises`)
console.log(`  ${exercises.reduce((sum, e) => sum + e.sets.length, 0)} total sets`)

// ── Generate output ──────────────────────────────────────────────
mkdirSync('scripts/output', { recursive: true })

// JSON output (localStorage format)
writeFileSync('scripts/output/import-data.json', JSON.stringify(exercises, null, 2))
console.log(`\nWrote scripts/output/import-data.json`)

// SQL output
function escSQL(str) {
  return str.replace(/'/g, "''")
}

let sql = `-- Notion → Lift migration for user ${userId}
-- Generated ${new Date().toISOString()}
-- SAFETY: All operations scoped to user_id = '${userId}'

BEGIN;

-- Clear existing test data for this user
DELETE FROM sets WHERE user_id = '${escSQL(userId)}';
DELETE FROM exercises WHERE user_id = '${escSQL(userId)}';

-- Insert exercises
`

for (const ex of exercises) {
  const tagsLiteral = `'{${ex.tags.map(t => `"${escSQL(t)}"`).join(',')}}'`
  sql += `INSERT INTO exercises (id, user_id, name, tags) VALUES ('${ex.id}', '${escSQL(userId)}', '${escSQL(ex.name)}', ${tagsLiteral});\n`
}

sql += `\n-- Insert sets\n`

for (const ex of exercises) {
  for (const set of ex.sets) {
    sql += `INSERT INTO sets (id, user_id, exercise_id, date, weight, reps, estimated_1rm) VALUES ('${set.id}', '${escSQL(userId)}', '${ex.id}', '${set.date}', ${set.weight}, ${set.reps}, ${set.estimated1RM});\n`
  }
}

sql += `\nCOMMIT;\n`

writeFileSync('scripts/output/import-data.sql', sql)
console.log(`Wrote scripts/output/import-data.sql`)

// Summary
console.log(`\nNext steps:`)
console.log(`  1. Review scripts/output/import-data.sql`)
console.log(`  2. Run the SQL in your Supabase SQL Editor`)
console.log(`  3. Clear localStorage in your browser and reload the app`)
