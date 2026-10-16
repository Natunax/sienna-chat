// sienna-voice: dictation for Sienna's input field.
//
// Speech is recognized on this Mac only: the request requires on-device
// recognition, so no audio leaves the machine, and nothing is written to disk.
// The helper writes JSON lines to stdout and reads one word per line on stdin:
// "stop" finishes the last words, "cancel" ends at once. When stdin closes
// (Sienna quit or crashed) the helper ends too.

import AVFoundation
import Foundation
import Speech

/// Sienna stops the microphone after five minutes, whatever happens.
let maxSeconds: TimeInterval = 300
let locales = ["de-DE", "en-US"]

func send(_ event: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: event) else { return }
    FileHandle.standardOutput.write(data + Data([0x0A]))
}

func fail(_ code: String) -> Never {
    send(["type": "error", "code": code])
    exit(1)
}

final class Dictation {
    let recognizer: SFSpeechRecognizer
    let engine = AVAudioEngine()
    var request = SFSpeechAudioBufferRecognitionRequest()
    var task: SFSpeechRecognitionTask?
    /// Text of earlier recognition rounds; a long pause can end one.
    var committed = ""
    var stopping = false
    var lastLevel = Date.distantPast

    init(locale: Locale) {
        guard let recognizer = SFSpeechRecognizer(locale: locale) else { fail("unsupported") }
        guard recognizer.supportsOnDeviceRecognition else { fail("onDevice") }
        guard recognizer.isAvailable else { fail("unavailable") }
        self.recognizer = recognizer
    }

    func newRequest() {
        request = SFSpeechAudioBufferRecognitionRequest()
        // No fallback to Apple's servers.
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        if #available(macOS 13, *) { request.addsPunctuation = true }
        let current = request
        task = recognizer.recognitionTask(with: current) { [weak self] result, error in
            DispatchQueue.main.async { self?.handle(result, error, for: current) }
        }
    }

    func start() {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { fail("noMicrophone") }
        newRequest()
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            DispatchQueue.main.async {
                guard let self, !self.stopping else { return }
                self.request.append(buffer)
                self.reportLevel(buffer)
            }
        }
        engine.prepare()
        do { try engine.start() } catch { fail("noMicrophone") }
        send(["type": "ready"])
        DispatchQueue.main.asyncAfter(deadline: .now() + maxSeconds) { [weak self] in
            send(["type": "limit"])
            self?.stop()
        }
    }

    func text(_ latest: String) -> String {
        [committed, latest].filter { !$0.isEmpty }.joined(separator: " ")
    }

    func handle(_ result: SFSpeechRecognitionResult?, _ error: Error?, for source: SFSpeechAudioBufferRecognitionRequest) {
        // Results of a finished round may still arrive after the next began.
        guard source === request else { return }
        if let result {
            let latest = result.bestTranscription.formattedString
            guard result.isFinal else {
                send(["type": "partial", "text": text(latest)])
                return
            }
            if stopping {
                finish(text(latest))
            } else {
                // A pause ended the round while the user still talks.
                committed = text(latest)
                newRequest()
            }
        } else if error != nil {
            // Stopping before any speech ends with "no speech detected".
            if stopping { finish(committed) } else { fail("failed") }
        }
    }

    func reportLevel(_ buffer: AVAudioPCMBuffer) {
        let now = Date()
        guard now.timeIntervalSince(lastLevel) > 0.06,
              let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
        lastLevel = now
        var sum: Float = 0
        for index in 0..<Int(buffer.frameLength) { sum += samples[index] * samples[index] }
        let rms = (sum / Float(buffer.frameLength)).squareRoot()
        let decibels = 20 * log10(max(rms, 0.000_01))
        send(["type": "level", "value": Double(min(max((decibels + 50) / 45, 0), 1))])
    }

    /// Ends the microphone and waits for the last words.
    func stop() {
        guard !stopping else { return }
        stopping = true
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request.endAudio()
        // The recognizer normally answers within a second.
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            self?.finish(self?.committed ?? "")
        }
    }

    func finish(_ text: String) {
        send(["type": "final", "text": text])
        send(["type": "end"])
        exit(0)
    }
}

func authorize(_ done: @escaping () -> Void) {
    let speech = { (granted: Bool) in
        guard granted else { fail("speechDenied") }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: DispatchQueue.main.async(execute: done)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                guard granted else { fail("micDenied") }
                DispatchQueue.main.async(execute: done)
            }
        default: fail("micDenied")
        }
    }
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized: speech(true)
    case .notDetermined: SFSpeechRecognizer.requestAuthorization { speech($0 == .authorized) }
    default: speech(false)
    }
}

let arguments = CommandLine.arguments
guard arguments.count == 2, locales.contains(arguments[1]) else { fail("failed") }
var dictation: Dictation?

// Commands from Sienna, one per line.
Thread.detachNewThread {
    while let line = readLine() {
        switch line {
        case "stop":
            DispatchQueue.main.async {
                // Stopped while macOS still asked for permission: nothing heard.
                guard let dictation else {
                    send(["type": "end"])
                    exit(0)
                }
                dictation.stop()
            }
        case "cancel": exit(0)
        default: continue
        }
    }
    exit(0)
}

authorize {
    let session = Dictation(locale: Locale(identifier: arguments[1]))
    dictation = session
    session.start()
}
dispatchMain()
