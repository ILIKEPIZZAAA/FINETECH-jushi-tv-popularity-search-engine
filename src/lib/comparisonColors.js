export const COMPARISON_COLORS = ['#FDBE34', '#51B5FF', '#FF6B70', '#B28CFF', '#78CE72']

export function comparisonColor(index) {
  return COMPARISON_COLORS[index] || `hsl(${(index * 137.508) % 360} 65% 45%)`
}

// Assign before hiding subjects without a value so every metric keeps the same identity.
export function comparisonSubjects(mainProject, competitors = []) {
  return [mainProject, ...competitors].filter(Boolean).map((subject, index) => ({
    ...subject,
    color: comparisonColor(index),
  }))
}

// Dark backgrounds need luminous strokes; white backgrounds need deeper strokes.
export function comparisonThemeColor(color, lightTheme = false) {
  if (!lightTheme) return color
  const index = COMPARISON_COLORS.indexOf(color)
  return ['#835711', '#126CB5', '#C4364C', '#7950C1', '#287B36'][index] || color
}
