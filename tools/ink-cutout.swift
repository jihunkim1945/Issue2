// WATCHMAN — cut a pen mark out of a phone photo of paper → black ink on transparent PNG (macOS only).
//   swift tools/ink-cutout.swift <photo> <out.png> x y w h
//   x y w h = the area to keep, in pixels of the photo as it is displayed (upright).
import CoreImage
import ImageIO
import UniformTypeIdentifiers

let a = CommandLine.arguments
let rx = Double(a[3])!, ry = Double(a[4])!, rw = Double(a[5])!, rh = Double(a[6])!
let src = CIImage(contentsOf: URL(fileURLWithPath: a[1]), options: [.applyOrientationProperty: true])!
let H = src.extent.height
let rect = CGRect(x: rx, y: H - ry - rh, width: rw, height: rh)          // CoreImage counts y from the bottom
let gray = src.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0])
// the paper's own brightness (shadows, light) = a heavy blur; ink = darker than the paper around it
let paper = gray.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 30])
let ctx = CIContext()
let W = Int(rw), Hh = Int(rh)
func pixels(_ img: CIImage) -> [UInt8] {
  var buf = [UInt8](repeating: 0, count: W * Hh * 4)
  ctx.render(img.cropped(to: rect), toBitmap: &buf, rowBytes: W * 4, bounds: rect, format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
  return buf
}
let g = pixels(gray), p = pixels(paper)
var out = [UInt8](repeating: 0, count: W * Hh * 4)
for i in stride(from: 0, to: g.count, by: 4) {
  let d = Double(p[i]) - Double(g[i])                      // how much darker than the paper
  let alpha = max(0, min(255, (d - 14) * 3.2))
  out[i + 3] = UInt8(alpha)                                  // black ink (premultiplied → rgb stays 0)
}
let cg = CGImage(width: W, height: Hh, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: W * 4,
                 space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                 provider: CGDataProvider(data: Data(out) as CFData)!, decode: nil, shouldInterpolate: true, intent: .defaultIntent)!
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, cg, nil)
CGImageDestinationFinalize(dest)
print("→", a[2], W, "×", Hh)
