import { CanvasProvider } from '@/context/CanvasContext';
import { SessionProvider } from '@/context/SessionContext';
import ShelfReader from '@/components/shelf/ShelfReader';

export default function ShelfReadPage() {
  return (
    <SessionProvider>
      <CanvasProvider>
        <ShelfReader />
      </CanvasProvider>
    </SessionProvider>
  );
}
