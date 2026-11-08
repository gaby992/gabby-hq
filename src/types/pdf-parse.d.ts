// pdf-parse ships no types. We import the lib entry point (not index.js,
// which does a debug read of a test file when it thinks it is the main
// module), so this is the only shape we need.
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string
    numpages: number
    numrender: number
    info: unknown
    metadata: unknown
    version: string
  }
  function pdfParse(data: Buffer | Uint8Array, options?: Record<string, unknown>): Promise<PdfParseResult>
  export = pdfParse
}
