// WATCHMAN — turn any video folder into small CCTV-style loops (macOS only, no installs).
//   swift tools/cctv-convert.swift "<folder with .mp4/.mov>" assets/video/cctv
// Optional: CCTV_START=19 CCTV_SECONDS=10 CCTV_CX=0.3 swift tools/cctv-convert.swift …  → start 19 s in, keep 10 s
// Output: cctv-01.mp4, cctv-02.mp4 …  640×480 (4:3), 10 fps, black & white, high contrast,
//         no sound, max 12 s each — about 1–3 MB per clip.
import AVFoundation
import CoreImage

let W: CGFloat = 640, H: CGFloat = 480, FPS: Int32 = 10, MAX_SECONDS = 12.0
let GAMMA = 0.65        // lower = brighter shadows (1 = unchanged)
let CONTRAST = 1.12     // 1 = unchanged
let input = CommandLine.arguments[1], output = CommandLine.arguments[2]
let ENV = ProcessInfo.processInfo.environment
let START = Double(ENV["CCTV_START"] ?? "") ?? 0, KEEP = Double(ENV["CCTV_SECONDS"] ?? "") ?? MAX_SECONDS
let CX = Double(ENV["CCTV_CX"] ?? "") ?? 0.5   // where the 4:3 window sits across a wide video: 0 = left edge, 0.5 = centre, 1 = right edge
let files = try! FileManager.default.contentsOfDirectory(atPath: input)
  .filter { [".mp4", ".mov", ".m4v"].contains(where: $0.lowercased().hasSuffix) }.sorted()

// optional 3rd argument: only redo these clip numbers, e.g. "3" or "3,7"
let only = CommandLine.arguments.count > 3 ? Set(CommandLine.arguments[3].split(separator: ",").compactMap { Int($0) }) : nil

for (i, name) in files.enumerated() {
  if let only = only, !only.contains(i + 1) { continue }
  let src = AVURLAsset(url: URL(fileURLWithPath: "\(input)/\(name)"))
  guard let track = src.tracks(withMediaType: .video).first else { print("skip (no video):", name); continue }
  let dur = min(CMTimeGetSeconds(src.duration) - START, KEEP)

  // video only, trimmed
  let comp = AVMutableComposition()
  let ct = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
  try! ct.insertTimeRange(CMTimeRange(start: CMTime(seconds: START, preferredTimescale: 600), duration: CMTime(seconds: dur, preferredTimescale: 600)), of: track, at: .zero)
  ct.preferredTransform = track.preferredTransform

  // per frame: fill 4:3, crop centre, black & white, harder contrast
  let vc = AVMutableVideoComposition(asset: comp) { req in
    var img = req.sourceImage
    let e = img.extent
    let s = max(W / e.width, H / e.height)
    img = img.transformed(by: CGAffineTransform(scaleX: s, y: s))
    let e2 = img.extent
    img = img.transformed(by: CGAffineTransform(translationX: -e2.origin.x - (e2.width - W) * CX, y: -e2.origin.y - (e2.height - H) / 2))
    img = img.cropped(to: CGRect(x: 0, y: 0, width: W, height: H))
    // mono → lift the shadows (gamma < 1) so night footage stays readable → a little extra contrast
    img = img.applyingFilter("CIPhotoEffectMono")
    img = img.applyingFilter("CIGammaAdjust", parameters: ["inputPower": GAMMA])
    img = img.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0, kCIInputContrastKey: CONTRAST, kCIInputBrightnessKey: 0.02])
    req.finish(with: img, context: nil)
  }
  vc.renderSize = CGSize(width: W, height: H)
  vc.frameDuration = CMTime(value: 1, timescale: FPS)

  let out = URL(fileURLWithPath: "\(output)/cctv-\(String(format: "%02d", i + 1)).mp4")
  try? FileManager.default.removeItem(at: out)
  let ex = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetMediumQuality)!
  ex.videoComposition = vc
  ex.outputURL = out
  ex.outputFileType = .mp4
  ex.shouldOptimizeForNetworkUse = true
  let sem = DispatchSemaphore(value: 0)
  ex.exportAsynchronously { sem.signal() }
  sem.wait()
  let kb = ((try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0) / 1024
  print(String(format: "%02d", i + 1), name, ex.status == .completed ? "→ \(out.lastPathComponent) \(kb) KB" : "FAILED \(ex.error?.localizedDescription ?? "")")
}
