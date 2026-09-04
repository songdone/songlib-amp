import Accelerate
import AVFoundation
import Foundation

/// 实时频谱分析。歌词和背景的视觉效果都由它驱动。
///
/// ## 为什么这件事在这个架构里才可能
///
/// 频谱需要拿到**解码后的 PCM**。用 AVPlayer 播的话音频在系统进程里解码，
/// 应用侧根本摸不到样本。而这个应用自己搭了解码链（见 `StreamingAudioEngine`），
/// PCM 就在自己的 `AVAudioEngine` 里 —— 在主混音节点上装一个 tap 就能拿到。
///
/// 所以"歌词跟着音乐呼吸"不是锦上添花的装饰，它是这条自研管线顺带解锁的
/// 能力。这也是当初不得不放弃 AVPlayer 换来的意外收益。
///
/// ## 实时线程的纪律
///
/// tap 的回调跑在**音频渲染线程**上。这个线程有硬实时约束：一次回调里
/// 分配内存、加锁等待、打日志，都可能让音频爆音（buffer underrun）。所以：
///
/// - FFT 的 setup 和所有中间缓冲**预先分配**，回调里只做数学
/// - 结果写入用 `os_unfair_lock`（自旋，不会让实时线程进内核等待），
///   而不是 NSLock
/// - 回调里不碰 Swift 的引用计数、不碰字典、不碰数组扩容
final class SpectrumAnalyzer {

    /// 频段数。
    ///
    /// 24 条是为电视定的：太少（8 条）看不出音乐的层次，太多（64 条）在
    /// 三米外糊成一片噪点，而且每一条都窄到看不清起伏。
    static let bandCount = 24

    /// FFT 窗口。1024 点在 44.1kHz 下是 23ms —— 足够跟上鼓点，
    /// 又不至于让低频分辨率太差（每格约 43Hz）。
    private static let fftSize = 1024
    private static let log2n = vDSP_Length(10)   // 2^10 = 1024

    // MARK: - 对外读取

    /// 各频段能量，0…1。UI 每帧读一次。
    func snapshot(into out: inout [Float]) {
        os_unfair_lock_lock(&lock)
        for index in 0..<Self.bandCount { out[index] = smoothed[index] }
        os_unfair_lock_unlock(&lock)
    }

    /// 低频能量（0…1）。背景的呼吸和歌词的脉动都跟它走 ——
    /// 人对"音乐的力度"的感觉主要来自低频。
    var bass: Float {
        os_unfair_lock_lock(&lock)
        let value = bassLevel
        os_unfair_lock_unlock(&lock)
        return value
    }

    /// 整体能量（0…1）。用来判断"这段是不是安静"。
    var level: Float {
        os_unfair_lock_lock(&lock)
        let value = overall
        os_unfair_lock_unlock(&lock)
        return value
    }

    // MARK: - 内部状态

    private var lock = os_unfair_lock()
    private var smoothed = [Float](repeating: 0, count: SpectrumAnalyzer.bandCount)
    private var bassLevel: Float = 0
    private var overall: Float = 0

    // 预分配的 FFT 资源。绝不在回调里创建。
    private let fftSetup: FFTSetup
    private var window: [Float]
    private var windowed: [Float]
    private var real: [Float]
    private var imaginary: [Float]
    private var magnitudes: [Float]
    private var raw: [Float]

    init() {
        fftSetup = vDSP_create_fftsetup(Self.log2n, FFTRadix(kFFTRadix2))!
        window = [Float](repeating: 0, count: Self.fftSize)
        // 汉宁窗：不加窗的话 FFT 会在窗口边界产生频谱泄漏，
        // 表现为所有频段都有一层假的底噪，视觉上就是"条永远不落到底"。
        vDSP_hann_window(&window, vDSP_Length(Self.fftSize), Int32(vDSP_HANN_NORM))
        windowed = [Float](repeating: 0, count: Self.fftSize)
        real = [Float](repeating: 0, count: Self.fftSize / 2)
        imaginary = [Float](repeating: 0, count: Self.fftSize / 2)
        magnitudes = [Float](repeating: 0, count: Self.fftSize / 2)
        raw = [Float](repeating: 0, count: Self.bandCount)
    }

    deinit {
        vDSP_destroy_fftsetup(fftSetup)
    }

    // MARK: - 装到引擎上

    func attach(to engine: AVAudioEngine) {
        let mixer = engine.mainMixerNode
        mixer.removeTap(onBus: 0)
        mixer.installTap(onBus: 0, bufferSize: AVAudioFrameCount(Self.fftSize), format: nil) {
            [weak self] buffer, _ in
            self?.process(buffer)
        }
    }

    func detach(from engine: AVAudioEngine) {
        engine.mainMixerNode.removeTap(onBus: 0)
        os_unfair_lock_lock(&lock)
        for index in smoothed.indices { smoothed[index] = 0 }
        bassLevel = 0
        overall = 0
        os_unfair_lock_unlock(&lock)
    }

    // MARK: - 处理（跑在音频线程上）

    private func process(_ buffer: AVAudioPCMBuffer) {
        guard let channels = buffer.floatChannelData else { return }
        let available = Int(buffer.frameLength)
        guard available >= Self.fftSize else { return }

        let samples = channels[0]

        // 加窗
        vDSP_vmul(samples, 1, window, 1, &windowed, 1, vDSP_Length(Self.fftSize))

        // 实数 FFT。vDSP 用的是"分裂复数"表示，输入要先打包进 real/imaginary。
        windowed.withUnsafeBufferPointer { input in
            input.baseAddress!.withMemoryRebound(
                to: DSPComplex.self, capacity: Self.fftSize / 2
            ) { complex in
                real.withUnsafeMutableBufferPointer { realPtr in
                    imaginary.withUnsafeMutableBufferPointer { imagPtr in
                        var split = DSPSplitComplex(realp: realPtr.baseAddress!,
                                                    imagp: imagPtr.baseAddress!)
                        vDSP_ctoz(complex, 2, &split, 1, vDSP_Length(Self.fftSize / 2))
                        vDSP_fft_zrip(fftSetup, &split, 1, Self.log2n, FFTDirection(FFT_FORWARD))
                        vDSP_zvabs(&split, 1, &magnitudes, 1, vDSP_Length(Self.fftSize / 2))
                    }
                }
            }
        }

        // 按**对数**分频。
        //
        // 均匀分频是错的：人耳对频率的感知是对数的，均匀分的话前两条就吃掉
        // 了几乎所有能量，后面二十条全是空的 —— 视觉上就是"只有左边在动"。
        let binCount = Self.fftSize / 2
        var maximum: Float = 0
        for band in 0..<Self.bandCount {
            let lowFraction = pow(Float(band) / Float(Self.bandCount), 2.2)
            let highFraction = pow(Float(band + 1) / Float(Self.bandCount), 2.2)
            var low = Int(lowFraction * Float(binCount))
            var high = Int(highFraction * Float(binCount))
            low = min(max(0, low), binCount - 1)
            high = min(max(low + 1, high), binCount)

            var sum: Float = 0
            for bin in low..<high { sum += magnitudes[bin] }
            let mean = sum / Float(high - low)
            // 转成分贝再归一化。线性幅度直接画出来的话，安静段几乎贴底、
            // 响的地方一下顶满，中间没有层次。
            let db = 20 * log10(max(mean, 1e-7))
            let normalized = max(0, min(1, (db + 68) / 68))
            raw[band] = normalized
            maximum = max(maximum, normalized)
        }

        // 时间上做平滑：上升快、回落慢。
        //
        // 这是让频谱"好看"的关键。上升快才跟得上鼓点；回落慢才不会在每两帧
        // 之间抖成一片噪声。两个系数不对称，是所有专业频谱表的做法。
        os_unfair_lock_lock(&lock)
        for band in 0..<Self.bandCount {
            let target = raw[band]
            let current = smoothed[band]
            smoothed[band] = target > current
                ? current + (target - current) * 0.55
                : current + (target - current) * 0.12
        }
        // 低频取前 1/6 的频段
        let bassBands = max(1, Self.bandCount / 6)
        var bassSum: Float = 0
        for band in 0..<bassBands { bassSum += smoothed[band] }
        bassLevel = bassSum / Float(bassBands)
        overall = maximum
        os_unfair_lock_unlock(&lock)
    }
}
