/**
 * Report Renderer — generates a printable HTML report from TrainingReport data.
 *
 * Opens a new window with styled HTML that the user can print to PDF via
 * the browser's native Print dialog (Cmd+P / Ctrl+P). No external dependencies.
 *
 * The printed output uses @media print rules for clean, professional formatting.
 */

import type { TrainingReport, ExerciseE1RMProgression, PREvent } from './trainingReport'

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function formatVolume(n: number, unit: string): string {
  return `${formatNumber(n)} ${unit}`
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[m - 1]} ${d}, ${y}`
}

function formatWeekLabel(mondayStr: string): string {
  const [, m, d] = mondayStr.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[m - 1]} ${d}`
}

function deltaSymbol(delta: number): string {
  if (delta > 0) return `+${delta}`
  if (delta < 0) return `${delta}`
  return '0'
}

// ── SVG sparkline for e1RM timeline ──────────────────────────────

function sparklineSvg(
  points: { date: string; e1RM: number }[],
  width: number,
  height: number,
): string {
  if (points.length < 2) return ''
  const min = Math.min(...points.map(p => p.e1RM))
  const max = Math.max(...points.map(p => p.e1RM))
  const range = max - min || 1
  const padding = 2

  const coords = points.map((p, i) => {
    const x = padding + (i / (points.length - 1)) * (width - 2 * padding)
    const y = padding + (1 - (p.e1RM - min) / range) * (height - 2 * padding)
    return { x, y }
  })

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="vertical-align: middle;">
    <polyline points="${coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')}" fill="none" stroke="#4A90D9" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${coords[coords.length - 1].x.toFixed(1)}" cy="${coords[coords.length - 1].y.toFixed(1)}" r="2.5" fill="#4A90D9"/>
  </svg>`
}

// ── Weekly bar chart ─────────────────────────────────────────────

function weeklyBarsSvg(
  weeks: { weekStart: string; daysTrained: number }[],
  maxDays: number,
  width: number,
  height: number,
): string {
  if (weeks.length === 0) return ''
  const barWidth = Math.min(24, (width - 20) / weeks.length - 4)
  const barGap = 4
  const totalBarWidth = weeks.length * (barWidth + barGap) - barGap
  const startX = (width - totalBarWidth) / 2
  const maxH = height - 20

  const bars = weeks.map((w, i) => {
    const x = startX + i * (barWidth + barGap)
    const h = maxDays > 0 ? (w.daysTrained / maxDays) * maxH : 0
    const y = height - 14 - h
    const fill = w.daysTrained > 0 ? '#4A90D9' : '#E5E7EB'
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth}" height="${h.toFixed(1)}" rx="2" fill="${fill}"/>
      <text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 2}" text-anchor="middle" font-size="7" fill="#9CA3AF">${w.daysTrained}</text>`
  }).join('\n')

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    ${bars}
  </svg>`
}

// ── Exercise table section ───────────────────────────────────────

function exerciseRow(ex: ExerciseE1RMProgression, unit: string): string {
  const deltaClass = ex.delta > 0 ? 'positive' : ex.delta < 0 ? 'negative' : ''
  return `<tr>
    <td class="exercise-name">
      ${escapeHtml(ex.name)}
      <span class="exercise-tags">${ex.tags.map(t => escapeHtml(t)).join(', ')}</span>
    </td>
    <td class="num">${ex.totalSets}</td>
    <td class="num">${formatVolume(ex.totalVolume, unit)}</td>
    <td class="num">${ex.startE1RM} → ${ex.peakE1RM} ${unit}</td>
    <td class="num ${deltaClass}">${deltaSymbol(ex.delta)}</td>
    <td class="sparkline">${sparklineSvg(ex.timeline, 100, 28)}</td>
  </tr>`
}

// ── PR timeline section ──────────────────────────────────────────

function prRow(pr: PREvent, unit: string): string {
  return `<tr>
    <td>${formatDate(pr.date)}</td>
    <td>${escapeHtml(pr.exerciseName)}</td>
    <td class="num">${pr.weight} ${unit} × ${pr.reps}</td>
    <td class="num">${pr.e1RM} ${unit}</td>
  </tr>`
}

// ── Main render function ─────────────────────────────────────────

export function renderReport(report: TrainingReport): string {
  const u = report.unitLabel
  const maxConsistencyDays = Math.max(...report.weeklyConsistency.map(w => w.daysTrained), 7)

  const exerciseRows = report.exerciseProgressions
    .slice(0, 20) // Cap at top 20 exercises by volume
    .map(ex => exerciseRow(ex, u))
    .join('\n')

  const prRows = report.prTimeline
    .map(pr => prRow(pr, u))
    .join('\n')

  const tagRows = report.tagVolume
    .map(t => `<tr><td>${escapeHtml(t.tag)}</td><td class="num">${t.sets}</td><td class="num">${formatVolume(t.volume, u)}</td></tr>`)
    .join('\n')

  const bwSection = report.bodyweight.timeline.length > 0
    ? `<section class="report-section">
        <h2>Body Weight</h2>
        <div class="stat-row">
          <div class="stat"><span class="stat-label">Start</span><span class="stat-value">${report.bodyweight.startWeight} ${u}</span></div>
          <div class="stat"><span class="stat-label">End</span><span class="stat-value">${report.bodyweight.endWeight} ${u}</span></div>
          <div class="stat"><span class="stat-label">Change</span><span class="stat-value ${(report.bodyweight.delta ?? 0) > 0 ? 'positive' : (report.bodyweight.delta ?? 0) < 0 ? 'negative' : ''}">${deltaSymbol(report.bodyweight.delta ?? 0)} ${u}</span></div>
        </div>
      </section>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lift Training Report — ${escapeHtml(report.periodLabel)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a;
    background: #fff;
    padding: 40px;
    max-width: 900px;
    margin: 0 auto;
    font-size: 13px;
    line-height: 1.5;
  }
  .report-header {
    text-align: center;
    margin-bottom: 32px;
    padding-bottom: 16px;
    border-bottom: 2px solid #1a1a1a;
  }
  .report-header h1 {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.5px;
    margin-bottom: 4px;
  }
  .report-header .period {
    font-size: 16px;
    color: #666;
    font-weight: 400;
  }
  .report-header .date-range {
    font-size: 11px;
    color: #999;
    margin-top: 2px;
  }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 16px;
    margin-bottom: 32px;
  }
  .summary-card {
    text-align: center;
    padding: 16px 8px;
    background: #f9fafb;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
  }
  .summary-card .card-value {
    font-size: 28px;
    font-weight: 700;
    color: #1a1a1a;
    display: block;
  }
  .summary-card .card-label {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 4px;
    display: block;
  }
  .report-section {
    margin-bottom: 28px;
    page-break-inside: avoid;
  }
  .report-section h2 {
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid #e5e7eb;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #444;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    text-align: left;
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #888;
    padding: 6px 8px;
    border-bottom: 1px solid #e5e7eb;
  }
  th.num, td.num { text-align: right; }
  td {
    padding: 8px;
    border-bottom: 1px solid #f3f4f6;
    vertical-align: middle;
  }
  .exercise-name {
    font-weight: 500;
  }
  .exercise-tags {
    display: block;
    font-size: 10px;
    color: #999;
    font-weight: 400;
  }
  .sparkline { text-align: center; }
  .positive { color: #16a34a; }
  .negative { color: #dc2626; }
  .stat-row {
    display: flex;
    gap: 24px;
    margin-bottom: 12px;
  }
  .stat {
    display: flex;
    flex-direction: column;
  }
  .stat-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #888;
  }
  .stat-value {
    font-size: 16px;
    font-weight: 600;
  }
  .consistency-chart {
    text-align: center;
    margin: 12px 0;
  }
  .footer {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid #e5e7eb;
    text-align: center;
    font-size: 10px;
    color: #bbb;
  }
  .print-hint {
    text-align: center;
    margin-bottom: 24px;
    padding: 12px;
    background: #eff6ff;
    border-radius: 8px;
    font-size: 12px;
    color: #3b82f6;
  }
  .report-toolbar {
    position: sticky;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    padding-top: calc(12px + env(safe-area-inset-top, 0px));
    margin: -40px -40px 24px;
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: saturate(180%) blur(12px);
    -webkit-backdrop-filter: saturate(180%) blur(12px);
    border-bottom: 1px solid #e5e7eb;
    min-height: 44px;
  }
  .back-button {
    appearance: none;
    border: none;
    background: transparent;
    color: #3b82f6;
    font: inherit;
    font-size: 16px;
    font-weight: 500;
    padding: 8px 12px;
    margin: -8px -12px;
    min-height: 44px;
    min-width: 44px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border-radius: 8px;
  }
  .back-button:hover { background: rgba(59, 130, 246, 0.08); }
  .back-button:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
  }
  .toolbar-title {
    font-size: 13px;
    font-weight: 600;
    color: #1a1a1a;
    text-align: center;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .toolbar-spacer { min-width: 44px; }
  @media print {
    body { padding: 20px; }
    .report-toolbar { display: none; }
    .print-hint { display: none; }
    .summary-card { border: 1px solid #ddd; }
    .report-section { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <nav class="report-toolbar" aria-label="Report navigation">
    <button type="button" class="back-button" id="back-to-lift" aria-label="Close report and return to Lift">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
      Back to Lift
    </button>
    <div class="toolbar-title">Training Report</div>
    <div class="toolbar-spacer" aria-hidden="true"></div>
  </nav>

  <div class="print-hint">
    Press <strong>Cmd+P</strong> (Mac) or <strong>Ctrl+P</strong> (Windows) to save as PDF, then tap <strong>Back to Lift</strong> to return
  </div>

  <div class="report-header">
    <h1>Training Report</h1>
    <div class="period">${escapeHtml(report.periodLabel)}</div>
    <div class="date-range">${formatDate(report.startDate)} – ${formatDate(report.endDate)}</div>
  </div>

  <div class="summary-grid">
    <div class="summary-card">
      <span class="card-value">${report.totalWorkoutDays}</span>
      <span class="card-label">Workout Days</span>
    </div>
    <div class="summary-card">
      <span class="card-value">${formatNumber(report.totalSets)}</span>
      <span class="card-label">Total Sets</span>
    </div>
    <div class="summary-card">
      <span class="card-value">${formatNumber(report.totalVolume)}</span>
      <span class="card-label">Volume (${escapeHtml(u)})</span>
    </div>
    <div class="summary-card">
      <span class="card-value">${report.uniqueExercises}</span>
      <span class="card-label">Exercises</span>
    </div>
    <div class="summary-card">
      <span class="card-value">${report.prCount}</span>
      <span class="card-label">PRs</span>
    </div>
  </div>

  ${report.weeklyConsistency.length > 0 ? `
  <section class="report-section">
    <h2>Weekly Consistency</h2>
    <div class="consistency-chart">
      ${weeklyBarsSvg(report.weeklyConsistency, maxConsistencyDays, Math.min(report.weeklyConsistency.length * 28 + 20, 800), 80)}
    </div>
    <table>
      <thead><tr>
        <th>Week of</th>
        <th class="num">Days</th>
        <th class="num">Sets</th>
        <th class="num">Volume</th>
      </tr></thead>
      <tbody>
        ${report.weeklyConsistency.map(w => `<tr>
          <td>${formatWeekLabel(w.weekStart)}</td>
          <td class="num">${w.daysTrained}</td>
          <td class="num">${w.sets}</td>
          <td class="num">${formatVolume(w.volume, u)}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>
  </section>` : ''}

  ${report.tagVolume.length > 0 ? `
  <section class="report-section">
    <h2>Volume by Muscle Group</h2>
    <table>
      <thead><tr>
        <th>Tag</th>
        <th class="num">Sets</th>
        <th class="num">Volume</th>
      </tr></thead>
      <tbody>${tagRows}</tbody>
    </table>
  </section>` : ''}

  ${report.exerciseProgressions.length > 0 ? `
  <section class="report-section">
    <h2>Exercise Progressions</h2>
    <table>
      <thead><tr>
        <th>Exercise</th>
        <th class="num">Sets</th>
        <th class="num">Volume</th>
        <th class="num">e1RM</th>
        <th class="num">Δ</th>
        <th class="sparkline">Trend</th>
      </tr></thead>
      <tbody>${exerciseRows}</tbody>
    </table>
  </section>` : ''}

  ${report.prTimeline.length > 0 ? `
  <section class="report-section">
    <h2>PR Timeline</h2>
    <table>
      <thead><tr>
        <th>Date</th>
        <th>Exercise</th>
        <th class="num">Set</th>
        <th class="num">e1RM</th>
      </tr></thead>
      <tbody>${prRows}</tbody>
    </table>
  </section>` : ''}

  ${bwSection}

  <div class="footer">
    Generated by Lift — ${new Date().toISOString().slice(0, 10)}
  </div>

  <script>
    (function () {
      var btn = document.getElementById('back-to-lift');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var openerUrl = null;
        try {
          if (window.opener && !window.opener.closed) {
            try { window.opener.focus(); } catch (_) {}
            try { openerUrl = window.opener.location.href; } catch (_) {}
          }
        } catch (_) {}
        try { window.close(); } catch (_) {}
        window.setTimeout(function () {
          if (openerUrl) {
            window.location.replace(openerUrl);
          } else if (document.referrer) {
            window.location.replace(document.referrer);
          } else {
            try { window.history.back(); } catch (_) {}
          }
        }, 120);
      });
    })();
  </script>
</body>
</html>`
}

/**
 * Open the report in a new browser window for printing.
 * Returns the window reference for testing.
 */
export function openReportWindow(html: string): Window | null {
  const win = window.open('', '_blank')
  if (!win) return null
  win.document.write(html)
  win.document.close()
  return win
}
