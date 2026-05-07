/**
 * Training report HTML renderer.
 *
 * Generates a self-contained HTML document with inline CSS that renders
 * a formatted training report. Optimized for print-to-PDF and mobile
 * Share Sheet workflows.
 *
 * No external dependencies — uses inline SVG for mini charts.
 */

import type { TrainingReport, ExerciseReport } from './trainingReport'

// ── SVG chart helpers ─────────────────────────────────────────────

function miniSparkline(
  data: { date: string; e1rm: number }[],
  width = 200,
  height = 40,
): string {
  if (data.length < 2) return ''
  const values = data.map(d => d.e1rm)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const padY = 4

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width
    const y = padY + ((max - d.e1rm) / range) * (height - padY * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const areaPoints = [
    `0,${height}`,
    ...points,
    `${width},${height}`,
  ].join(' ')

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="display:block;">
    <polygon points="${areaPoints}" fill="rgba(59,130,246,0.1)" />
    <polyline points="${points.join(' ')}" fill="none" stroke="#3b82f6" stroke-width="1.5" />
    <circle cx="${points[points.length - 1].split(',')[0]}" cy="${points[points.length - 1].split(',')[1]}" r="2.5" fill="#3b82f6" />
  </svg>`
}

function volumeBar(
  value: number,
  maxValue: number,
  label: string,
  count: string,
): string {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0
  return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
    <span style="min-width:80px;font-size:13px;color:#374151;">${label}</span>
    <div style="flex:1;height:16px;background:#f3f4f6;border-radius:4px;overflow:hidden;">
      <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#3b82f6,#60a5fa);border-radius:4px;"></div>
    </div>
    <span style="min-width:48px;text-align:right;font-size:12px;color:#6b7280;">${count}</span>
  </div>`
}

// ── Formatters ────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function fmtWeight(lbs: number, unit: 'lbs' | 'kg'): string {
  if (unit === 'kg') return `${(lbs * 0.453592).toFixed(1)} kg`
  return `${Math.round(lbs)} lbs`
}

function deltaArrow(delta: number | null): string {
  if (delta === null) return ''
  if (delta > 0) return `<span style="color:#16a34a;">+${Math.round(delta)}</span>`
  if (delta < 0) return `<span style="color:#dc2626;">${Math.round(delta)}</span>`
  return '<span style="color:#6b7280;">±0</span>'
}

// ── Main renderer ─────────────────────────────────────────────────

export function renderTrainingReportHtml(
  report: TrainingReport,
  options: { weightUnit?: 'lbs' | 'kg'; displayWeight?: (lbs: number) => number } = {},
): string {
  const unit = options.weightUnit ?? 'lbs'
  const dw = options.displayWeight ?? ((lbs: number) => unit === 'kg' ? +(lbs * 0.453592).toFixed(1) : lbs)
  const { summary, exercises, tagVolume, bodyweight } = report

  // ── Summary section ──
  const summaryHtml = `
    <div class="stats-grid">
      <div class="stat">
        <div class="stat-value">${summary.totalWorkouts}</div>
        <div class="stat-label">Workouts</div>
      </div>
      <div class="stat">
        <div class="stat-value">${fmtNumber(summary.totalSets)}</div>
        <div class="stat-label">Sets</div>
      </div>
      <div class="stat">
        <div class="stat-value">${fmtNumber(Math.round(dw(summary.totalVolume)))}</div>
        <div class="stat-label">Volume (${unit})</div>
      </div>
      <div class="stat">
        <div class="stat-value">${summary.uniqueExercises}</div>
        <div class="stat-label">Exercises</div>
      </div>
      <div class="stat">
        <div class="stat-value">${summary.prsHit}</div>
        <div class="stat-label">PRs Hit</div>
      </div>
      <div class="stat">
        <div class="stat-value">${summary.consistency}%</div>
        <div class="stat-label">Consistency</div>
      </div>
    </div>`

  // ── Tag volume section ──
  const maxTagSets = tagVolume.length > 0 ? tagVolume[0].totalSets : 1
  const tagHtml = tagVolume.length > 0
    ? `<section class="section">
        <h2>Volume by Tag</h2>
        <div class="volume-bars">
          ${tagVolume.map(t =>
            volumeBar(t.totalSets, maxTagSets, t.tag, `${t.totalSets} sets`)
          ).join('')}
        </div>
      </section>`
    : ''

  // ── Exercise details ──
  const topExercises = exercises.slice(0, 10) // cap at 10 for readability
  const exerciseHtml = topExercises.length > 0
    ? `<section class="section">
        <h2>Exercise Breakdown</h2>
        ${topExercises.map(ex => exerciseCard(ex, unit, dw)).join('')}
        ${exercises.length > 10
          ? `<p class="muted" style="text-align:center;margin-top:12px;">+ ${exercises.length - 10} more exercises</p>`
          : ''}
      </section>`
    : ''

  // ── Bodyweight section ──
  const bwHtml = bodyweight.entries.length > 0
    ? `<section class="section">
        <h2>Bodyweight</h2>
        <div class="bw-summary">
          ${bodyweight.startWeight != null ? `<span>Start: ${fmtWeight(bodyweight.startWeight, unit)}</span>` : ''}
          ${bodyweight.endWeight != null ? `<span>End: ${fmtWeight(bodyweight.endWeight, unit)}</span>` : ''}
          ${bodyweight.delta != null ? `<span>Change: ${deltaArrow(unit === 'kg' ? bodyweight.delta * 0.453592 : bodyweight.delta)} ${unit}</span>` : ''}
        </div>
        ${miniSparkline(bodyweight.entries.map(e => ({ date: e.date, e1rm: e.weight })), 500, 60)}
      </section>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lift Training Report — ${summary.period.label}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #111827;
      background: #fff;
      max-width: 640px;
      margin: 0 auto;
      padding: 32px 24px;
      line-height: 1.5;
    }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
    h2 { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #111827; }
    .subtitle { font-size: 14px; color: #6b7280; margin-bottom: 24px; }
    .section { margin-top: 32px; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }
    .stat {
      text-align: center;
      padding: 16px 8px;
      background: #f9fafb;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
    }
    .stat-value { font-size: 28px; font-weight: 700; color: #111827; }
    .stat-label { font-size: 12px; color: #6b7280; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
    .volume-bars { margin-top: 8px; }
    .ex-card {
      padding: 16px;
      margin-bottom: 12px;
      background: #f9fafb;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
    }
    .ex-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
    .ex-name { font-size: 15px; font-weight: 600; }
    .ex-sets { font-size: 13px; color: #6b7280; }
    .ex-stats { display: flex; gap: 16px; font-size: 13px; color: #374151; flex-wrap: wrap; }
    .ex-stats span { white-space: nowrap; }
    .ex-spark { margin-top: 8px; }
    .bw-summary { display: flex; gap: 24px; font-size: 14px; color: #374151; margin-bottom: 8px; }
    .muted { color: #9ca3af; font-size: 13px; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; text-align: center; }
    .tag-pills { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
    .tag-pill { font-size: 11px; background: #e5e7eb; color: #374151; padding: 1px 8px; border-radius: 999px; }
    @media print {
      body { padding: 16px; max-width: 100%; }
      .section { break-inside: avoid; }
      .ex-card { break-inside: avoid; }
    }
    @media (max-width: 480px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      body { padding: 16px; }
    }
  </style>
</head>
<body>
  <h1>Training Report</h1>
  <p class="subtitle">${summary.period.label} · ${fmtDate(summary.period.startDate)} – ${fmtDate(summary.period.endDate)}</p>

  ${summaryHtml}
  ${tagHtml}
  ${exerciseHtml}
  ${bwHtml}

  <div class="footer">
    Generated by Lift · ${fmtDate(report.generatedAt.slice(0, 10))}
  </div>
</body>
</html>`
}

function exerciseCard(
  ex: ExerciseReport,
  unit: 'lbs' | 'kg',
  dw: (lbs: number) => number,
): string {
  const bestDisplay = unit === 'kg' ? dw(ex.bestWeight).toFixed(1) : Math.round(ex.bestWeight)
  const e1rmDisplay = unit === 'kg' ? dw(ex.bestE1RM).toFixed(1) : Math.round(ex.bestE1RM)

  return `<div class="ex-card">
    <div class="ex-header">
      <span class="ex-name">${escapeHtml(ex.name)}</span>
      <span class="ex-sets">${ex.totalSets} sets</span>
    </div>
    <div class="ex-stats">
      <span>Best: ${bestDisplay} ${unit} × ${ex.bestReps}</span>
      <span>e1RM: ${e1rmDisplay} ${unit}</span>
      ${ex.e1rmDelta !== null ? `<span>Δ ${deltaArrow(unit === 'kg' ? ex.e1rmDelta * 0.453592 : ex.e1rmDelta)} ${unit}</span>` : ''}
    </div>
    ${ex.tags.length > 0
      ? `<div class="tag-pills">${ex.tags.map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}</div>`
      : ''}
    ${ex.timeline.length >= 2
      ? `<div class="ex-spark">${miniSparkline(ex.timeline)}</div>`
      : ''}
  </div>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
