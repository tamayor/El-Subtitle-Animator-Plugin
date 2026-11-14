// Collage b-roll: what is on a picture, with macOS Vision (no download, no key). Prints one JSON line:
// { w, h, lines: [{ text, box, words: [{ text, box }] }], faces: [box], objects: [box] }
// Boxes are [x, y, w, h], 0..1 of the picture, top-left origin. `objects` are the salient things Vision sees (logos,
// emblems, the person), for collage-plan.js evidencePlan to sort out.
//   swiftc -O vision-scan.swift -o vision-scan && ./vision-scan <picture>
import AppKit
import Foundation
import Vision

func out(_ v: Any) {
    let d = try! JSONSerialization.data(withJSONObject: v, options: [])
    print(String(data: d, encoding: .utf8)!)
}
func box(_ r: CGRect) -> [Double] {
    let q = { (v: CGFloat) in (Double(v) * 10000).rounded() / 10000 }
    return [q(r.minX), q(1 - r.maxY), q(r.width), q(r.height)]
}

guard CommandLine.arguments.count > 1,
      let img = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    out(["error": "cannot read the picture"])
    exit(1)
}

let text = VNRecognizeTextRequest()
text.recognitionLevel = .accurate
text.usesLanguageCorrection = false
let faces = VNDetectFaceRectanglesRequest()
let salient = VNGenerateObjectnessBasedSaliencyImageRequest()
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do { try handler.perform([text, faces, salient]) } catch {
    out(["error": "Vision: \(error.localizedDescription)"])
    exit(1)
}

var lines: [[String: Any]] = []
for obs in text.results ?? [] {
    guard let c = obs.topCandidates(1).first else { continue }
    let s = c.string
    var words: [[String: Any]] = []
    var i = s.startIndex
    while i < s.endIndex {
        while i < s.endIndex && s[i] == " " { i = s.index(after: i) }
        var j = i
        while j < s.endIndex && s[j] != " " { j = s.index(after: j) }
        if i < j, let r = try? c.boundingBox(for: i..<j) {
            words.append(["text": String(s[i..<j]), "box": box(r.boundingBox)])
        }
        i = j
    }
    lines.append(["text": s, "box": box(obs.boundingBox), "words": words])
}
let faceBoxes = (faces.results ?? []).map { box($0.boundingBox) }
let objects = ((salient.results?.first)?.salientObjects ?? []).map { box($0.boundingBox) }
out(["w": cg.width, "h": cg.height, "lines": lines, "faces": faceBoxes, "objects": objects])
