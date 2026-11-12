// WATCHMAN — render every page of a PDF to JPGs (macOS only).
//   swift tools/pdf-pages.swift "<file.pdf>" <out folder> [max px, default 1800]
import PDFKit
import AppKit
let a = CommandLine.arguments
let doc = PDFDocument(url: URL(fileURLWithPath: a[1]))!
let maxPx = a.count > 3 ? CGFloat(Double(a[3])!) : 1800
for i in 0..<doc.pageCount {
  let page = doc.page(at: i)!
  let b = page.bounds(for: .mediaBox)
  let s = maxPx / max(b.width, b.height)
  let w = Int(b.width * s), h = Int(b.height * s)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  let ctx = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.current = ctx
  ctx.cgContext.setFillColor(NSColor.white.cgColor); ctx.cgContext.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.cgContext.scaleBy(x: s, y: s)
  page.draw(with: .mediaBox, to: ctx.cgContext)
  NSGraphicsContext.restoreGraphicsState()
  let out = "\(a[2])/page-\(String(format: "%02d", i + 1)).jpg"
  try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.78])!.write(to: URL(fileURLWithPath: out))
  print(out, w, "×", h)
}
