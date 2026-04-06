export const formatQualityDisplay = (
  quality: string | number | null | undefined, 
  sampleProduction: string | number | null | undefined,
  role: string | undefined,
  teamName: string | undefined
): string => {
  if (!quality) return '—';
  return String(quality);
};
