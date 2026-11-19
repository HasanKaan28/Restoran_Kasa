import { DuplicateCategoryError } from '@/data/errors';

/** Saves a name and returns the message for the field, or nothing when it was saved. */
export async function saveCategoryName(
  save: () => Promise<unknown>,
  name: string,
): Promise<string | undefined> {
  if (name.trim() === '') {
    return 'Kategori adı gerekli.';
  }
  try {
    await save();
    return undefined;
  } catch (error) {
    return error instanceof DuplicateCategoryError
      ? 'Bu adda bir kategori var.'
      : 'Kategori kaydedilemedi.';
  }
}
