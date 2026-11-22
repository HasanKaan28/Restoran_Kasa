import { printView } from '@/pos/printView';
import { DailyReportSheet, type DailyReportModel } from './DailyReportSheet';

const PAGE_RULE = '@page { size: A4; margin: 15mm; }';

/** Prints the daily report on A4; the print window can save it as a PDF. */
export function printDailyReport(model: DailyReportModel, print?: () => void): void {
  printView(
    <div className="text-black">
      <DailyReportSheet model={model} />
    </div>,
    () => PAGE_RULE,
    print,
  );
}
