import SwiftUI

/// 电视上的登录。
///
/// 不让用户在电视上打字。显示一个四位短码和一张二维码，手机扫一下或者去
/// plex.tv/link 输一次就完了。
struct SignInView: View {
    @ObservedObject var state: AppState

    var body: some View {
        ZStack {
            Theme.canvas.ignoresSafeArea()
            VStack(spacing: 44) {
                VStack(spacing: 12) {
                    Text("SongLib")
                        .font(.system(size: 64, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text("大屏歌词 · 连接你的 Plex 音乐库")
                        .font(.system(size: 30, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }

                if let pin = state.pin {
                    pairing(pin: pin)
                } else if let failure = state.failure {
                    VStack(spacing: 24) {
                        Text(failure)
                            .font(.system(size: 30, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                            .multilineTextAlignment(.center)
                        Button("重试") { state.startPairing() }
                            .font(.system(size: 30, weight: .semibold))
                    }
                } else {
                    ProgressView()
                        .scaleEffect(1.6)
                }
            }
            .padding(Theme.screenH)
        }
        .task { state.startPairing() }
    }

    private func pairing(pin: PlexPin) -> some View {
        HStack(spacing: 70) {
            VStack(alignment: .leading, spacing: 26) {
                step(1, "在手机或电脑上打开")
                Text("plex.tv/link")
                    .font(.system(size: 46, weight: .bold, design: .monospaced))
                    .foregroundStyle(Theme.textPrimary)
                step(2, "输入这个配对码")
                Text(pin.code)
                    .font(.system(size: 96, weight: .heavy, design: .monospaced))
                    .tracking(14)
                    .foregroundStyle(Theme.lyricActive)
                Text("或者用手机相机扫右边的码")
                    .font(.system(size: 26))
                    .foregroundStyle(Theme.textTertiary)
            }

            if let url = PlexAuth.qrURL(for: pin.code) {
                CoverImage(url: url, cornerRadius: 16)
                    .frame(width: 320, height: 320)
                    .padding(20)
                    .background(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .fill(Color.white)
                    )
            }
        }
    }

    private func step(_ number: Int, _ text: String) -> some View {
        HStack(spacing: 14) {
            Text("\(number)")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(Theme.canvas)
                .frame(width: 40, height: 40)
                .background(Circle().fill(Theme.textSecondary))
            Text(text)
                .font(.system(size: 30, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
        }
    }
}
