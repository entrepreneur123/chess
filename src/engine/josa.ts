/**
 * Korean particle picker: attaches the right form of a particle pair to a word depending on
 * whether its last syllable has a final consonant (batchim), e.g. 브루타일을 / 마르키를.
 * Non-Hangul endings fall back to the consonant form.
 */
export type JosaPair = '을/를' | '이/가' | '은/는' | '와/과';

export function josa(word: string, pair: JosaPair): string {
  const [withBatchim, without] = pair.split('/');
  const code = word.charCodeAt(word.length - 1);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return word + withBatchim;
  return word + ((code - 0xac00) % 28 === 0 ? without : withBatchim);
}
