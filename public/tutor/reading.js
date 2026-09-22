export function starterFor(starterCode, language) {
  const code = starterCode?.[language];
  if (typeof code !== 'string' || !code.trim()) return null;
  const comment = language === 'python' ? '# Write your code inside the method below.' : '// Write your code inside the method below.';
  return `${comment}\n${code}`;
}

export function readingLevel(probability) {
  if (probability < 20) return 'Much colder';
  if (probability < 40) return 'Cooler';
  if (probability <= 60) return 'Neutral or uncertain';
  if (probability <= 80) return 'Warmer';
  return 'Much hotter';
}
