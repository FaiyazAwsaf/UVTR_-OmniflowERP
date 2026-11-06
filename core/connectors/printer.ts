/**
 * Simulated printer (plan §3.17): the print preview is the real browser print
 * of the PrintLayout sheet; "Send to printer" only reports success, with the
 * Simulated badge. Returns the label to show in the toast.
 */
export function sendToPrinter(docNo: string, copies = 1): { ok: true; message: string } {
  return { ok: true, message: `${docNo} × ${copies}` }
}
