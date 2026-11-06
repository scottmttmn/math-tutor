import type { DrawingCanvasHandle } from '@/components/workspace/DrawingCanvas';
import { MAX_BOARD_PICTURE, problemImageFromFile } from '@/lib/shelf';

/** Board → Add picture…: an image, or a PDF's first page, put on the open ink board. False when it couldn't be. */
export async function addPictureFromFile(handle: DrawingCanvasHandle | null, file: File): Promise<boolean> {
  if (!handle?.addPicture) return false;
  try {
    // The board is fixed before the file is read, so a picture never lands on a board opened meanwhile.
    return await handle.addPicture(problemImageFromFile(file, MAX_BOARD_PICTURE));
  } catch (error) {
    console.error('Could not add the picture', error);
    return false;
  }
}
