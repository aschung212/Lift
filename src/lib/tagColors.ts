export interface TagColor {
  border: string
  bg: string
}

const PALETTE: TagColor[] = [
  { border: '#2dd4bf', bg: 'rgba(45,212,191,0.12)' },  // teal
  { border: '#f472b6', bg: 'rgba(244,114,182,0.12)' },  // pink
  { border: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },   // sky
  { border: '#fb923c', bg: 'rgba(251,146,60,0.12)' },   // orange
  { border: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },  // violet
  { border: '#4ade80', bg: 'rgba(74,222,128,0.12)' },   // green
  { border: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },   // amber
  { border: '#f87171', bg: 'rgba(248,113,113,0.12)' },  // red
]

function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export function getTagColor(tagName: string): TagColor {
  return PALETTE[hash(tagName) % PALETTE.length]
}
