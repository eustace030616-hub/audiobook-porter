import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = ClamBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}


import UIKit
import Capacitor
import AVFoundation
import MediaPlayer

final class ClamBridgeViewController: CAPBridgeViewController {
    private var resumeAfterRouteChange = false
    private var routeObserver: NSObjectProtocol?

    override func viewDidLoad() {
        super.viewDidLoad()
        configureAudioSession()
        observeAudioRoute()
        configureRemoteCommands()
    }

    deinit {
        if let routeObserver {
            NotificationCenter.default.removeObserver(routeObserver)
        }
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio,
                                    options: [.allowAirPlay, .allowBluetoothA2DP])
            try session.setActive(true)
        } catch {
            CAPLog.print("Clam audio session: \(error.localizedDescription)")
        }
    }

    private func observeAudioRoute() {
        routeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.handleRouteChange(notification)
        }
    }

    private func handleRouteChange(_ notification: Notification) {
        guard let reasonValue = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue) else {
            return
        }

        switch reason {
        case .oldDeviceUnavailable:
            // The web audio element normally pauses when the route disappears.
            // Remember whether it was playing before the AirPods went away.
            runJS("window.__clamNative?.isPlaying()") { [weak self] value in
                self?.resumeAfterRouteChange = (value as? Bool) ?? false
            }
        case .newDeviceAvailable:
            guard resumeAfterRouteChange else { return }
            resumeAfterRouteChange = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
                self?.runJS("window.__clamNative?.resume()")
            }
        default:
            break
        }
    }

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true

        center.playCommand.addTarget { [weak self] _ in
            self?.runJS("window.__clamNative?.resume()")
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            self?.runJS("window.__clamNative?.pause()")
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.runJS("window.__clamNative?.toggle()")
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.runJS("window.__clamNative?.next()")
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            self?.runJS("window.__clamNative?.previous()")
            return .success
        }
    }

    private func runJS(_ script: String, completion: ((Any?) -> Void)? = nil) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(script) { value, error in
                if let error {
                    CAPLog.print("Clam native JS: \(error.localizedDescription)")
                }
                completion?(value)
            }
        }
    }
}
