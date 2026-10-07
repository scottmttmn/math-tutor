import { CanvasProvider } from '@/context/CanvasContext';
import { SessionProvider } from '@/context/SessionContext';
import Workbook from '@/components/workbook/Workbook';

export default function WorkbookPage() {
  return (
    <SessionProvider>
      <CanvasProvider>
        <Workbook />
      </CanvasProvider>
    </SessionProvider>
  );
}
