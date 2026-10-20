export const COMPARISON_COLORS = ['#FDBE34', '#5DCAE3', '#FF6B70', '#B28CFF', '#2EC4B6']

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
