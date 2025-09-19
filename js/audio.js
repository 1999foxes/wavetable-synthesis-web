export let audioContext = null;
export let analyser = null;
let oscillator = null;

export function initAudio() {
    if (!audioContext) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioCtx();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
    }
    return { audioContext, analyser };
}

export async function startOscillator(createOscillator) {
    const { audioContext, analyser } = initAudio();
    await audioContext.resume();
    if (!oscillator) {
        oscillator = createOscillator(audioContext);
        oscillator.connect(analyser);
        analyser.connect(audioContext.destination);
        oscillator.start();
    }
}

export function createSineOscillator(audioContext) {
    const oscillator = audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = 440;
    return oscillator;
}

export function createWavetableOscillator(audioContext, wavetable) {
    const oscillator = audioContext.createOscillator();
    const wave = audioContext.createPeriodicWave(wavetable.real, wavetable.imag);
    oscillator.setPeriodicWave(wave);
    return oscillator;
}

export function createSawtoothFromWavetable(audioContext) {
    // Create a sawtooth waveform using a custom wave table
    // Sawtooth: all harmonics, amplitudes ~ 1/n, phase = 0
    const nHarmonics = 32;
    const real = new Float32Array(nHarmonics);
    const imag = new Float32Array(nHarmonics);

    real[0] = 0; // DC offset

    for (let n = 1; n < nHarmonics; n++) {
        real[n] = 0;
        // Sawtooth: sign alternates, amplitude 1/n
        imag[n] = (2 / (n * Math.PI)) * (n % 2 === 0 ? 0 : 1); // Only odd harmonics
        imag[n] = 1 / n; // Actually, sawtooth uses all harmonics, not just odd
    }

    // Actually, sawtooth uses all harmonics, so:
    for (let n = 1; n < nHarmonics; n++) {
        real[n] = 0;
        imag[n] = -1 / n;
    }

    const wave = audioContext.createPeriodicWave(real, imag, { disableNormalization: false });
    const oscillator = audioContext.createOscillator();
    oscillator.setPeriodicWave(wave);
    oscillator.frequency.value = 440;
    return oscillator;
}

/**
 * WavetableOscillator allows blending across a list of wavetables using a normalized position [0, 1].
 * Each wavetable entry should be an object with { real: Float32Array, imag: Float32Array }.
 */
export class WavetableOscillator {
    constructor(audioContext, wavetables, options = {}) {
        this.audioContext = audioContext;
        this.wavetables = Array.isArray(wavetables) ? wavetables : [];
        this.oscillator = audioContext.createOscillator();

        // Pre-create PeriodicWave instances for the provided wavetables for fast switching
        this._periodicWaves = this.wavetables.map((wt) =>
            this.audioContext.createPeriodicWave(wt.real, wt.imag)
        );

        // Default to first wavetable if available
        if (this._periodicWaves.length > 0) {
            this.oscillator.setPeriodicWave(this._periodicWaves[0]);
        }

        if (options.frequency != null) {
            this.oscillator.frequency.value = options.frequency;
        }

        this._position = 0;
    }

    /**
     * Append a new wavetable to the oscillator's blend list.
     */
    addWavetable(wavetable) {
        if (!wavetable || !wavetable.real || !wavetable.imag) return;
        this.wavetables.push(wavetable);
        const wave = this.audioContext.createPeriodicWave(wavetable.real, wavetable.imag);
        this._periodicWaves.push(wave);
        // Optionally snap to the newly added wave if position was at end
        const lastIndex = this.wavetables.length - 1;
        if (this._position >= 1 && lastIndex >= 0) {
            this.oscillator.setPeriodicWave(this._periodicWaves[lastIndex]);
        }
    }

    /**
     * Sets the blend position across the wavetable list.
     * position: number in [0, 1], where 0 selects the first wavetable and 1 the last.
     * This creates a new PeriodicWave by linearly interpolating the Fourier coefficients.
     */
    setPosition(position) {
        const clamped = Math.max(0, Math.min(1, position));
        this._position = clamped;

        const numWaves = this.wavetables.length;
        if (numWaves === 0) return;
        if (numWaves === 1) {
            // Nothing to blend, ensure the one wave is set
            if (this._periodicWaves[0]) {
                this.oscillator.setPeriodicWave(this._periodicWaves[0]);
            }
            return;
        }

        const lastIndex = numWaves - 1;
        const scaled = clamped * lastIndex;
        const i0 = Math.floor(scaled);
        const i1 = Math.min(i0 + 1, lastIndex);
        const t = scaled - i0;

        const wt0 = this.wavetables[i0];
        const wt1 = this.wavetables[i1];

        const maxLen = Math.max(
            wt0.real.length,
            wt0.imag.length,
            wt1.real.length,
            wt1.imag.length
        );

        const real = new Float32Array(maxLen);
        const imag = new Float32Array(maxLen);

        for (let n = 0; n < maxLen; n++) {
            const r0 = n < wt0.real.length ? wt0.real[n] : 0;
            const i0v = n < wt0.imag.length ? wt0.imag[n] : 0;
            const r1 = n < wt1.real.length ? wt1.real[n] : 0;
            const i1v = n < wt1.imag.length ? wt1.imag[n] : 0;

            real[n] = r0 * (1 - t) + r1 * t;
            imag[n] = i0v * (1 - t) + i1v * t;
        }

        const blended = this.audioContext.createPeriodicWave(real, imag, { disableNormalization: false });
        this.oscillator.setPeriodicWave(blended);
    }

    start(when = 0) {
        this.oscillator.start(when);
    }

    stop(when = 0) {
        this.oscillator.stop(when);
    }

    connect(destination) {
        return this.oscillator.connect(destination);
    }

    disconnect(...args) {
        this.oscillator.disconnect(...args);
    }

    get position() {
        return this._position;
    }

    get frequency() {
        return this.oscillator.frequency;
    }

    get detune() {
        return this.oscillator.detune;
    }
}

// -------------------- WAV import utilities --------------------

/**
 * Decode a WAV file into an AudioBuffer and convert a single-cycle wavetable.
 * Returns { real: Float32Array, imag: Float32Array }
 */
export async function wavFileToWavetable(file, options = {}) {
    const { harmonics = 32, minFrequency = 50, maxFrequency = 2000 } = options;
    const { audioContext } = initAudio();

    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await decodeArrayBufferToAudioBuffer(audioContext, arrayBuffer);
    const samples = audioBuffer.getChannelData(0);

    const singleCycle = extractSingleCycle(samples, audioBuffer.sampleRate, { minFrequency, maxFrequency });
    const wavetable = singleCycleToFourier(singleCycle, harmonics);
    return wavetable;
}

function decodeArrayBufferToAudioBuffer(ctx, arrayBuffer) {
    return new Promise((resolve, reject) => {
        // Some browsers still require callback style
        try {
            const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
            if (p && typeof p.then === 'function') {
                p.then(resolve).catch(reject);
            }
        } catch (err) {
            reject(err);
        }
    });
}

function extractSingleCycle(samples, sampleRate, { minFrequency = 50, maxFrequency = 2000 } = {}) {
    if (!samples || samples.length === 0) return new Float32Array([0]);

    // Work on a manageable window
    const windowSize = Math.min(samples.length, 16384);
    const windowStart = 0;
    const window = samples.subarray(windowStart, windowStart + windowSize);

    // Estimate period using simple autocorrelation
    const minLag = Math.max(2, Math.floor(sampleRate / maxFrequency));
    const maxLag = Math.min(window.length - 2, Math.floor(sampleRate / minFrequency));

    let bestLag = minLag;
    let bestScore = -Infinity;

    for (let lag = minLag; lag <= maxLag; lag++) {
        let sum = 0;
        const limit = window.length - lag;
        for (let i = 0; i < limit; i++) {
            sum += window[i] * window[i + lag];
        }
        if (sum > bestScore) {
            bestScore = sum;
            bestLag = lag;
        }
    }

    const period = Math.max(2, bestLag);

    // Find a rising zero-crossing that allows a full period slice
    const searchLimit = window.length - period - 2;
    let startIndex = 0;
    for (let i = 0; i < searchLimit; i++) {
        const s0 = window[i];
        const s1 = window[i + 1];
        if (s0 <= 0 && s1 > 0) {
            startIndex = i + 1;
            break;
        }
    }

    if (startIndex + period > window.length) {
        startIndex = 0;
    }

    const cycle = new Float32Array(period);
    for (let i = 0; i < period; i++) {
        cycle[i] = window[startIndex + i];
    }

    // Normalize to [-1, 1] peak to avoid extreme coefficient magnitudes
    let peak = 0;
    for (let i = 0; i < cycle.length; i++) {
        const a = Math.abs(cycle[i]);
        if (a > peak) peak = a;
    }
    if (peak > 0) {
        const scale = 1 / peak;
        for (let i = 0; i < cycle.length; i++) {
            cycle[i] *= scale;
        }
    }

    return cycle;
}

function singleCycleToFourier(cycle, harmonics = 32) {
    const N = cycle.length;
    const real = new Float32Array(harmonics);
    const imag = new Float32Array(harmonics);

    // DC term
    let mean = 0;
    for (let n = 0; n < N; n++) mean += cycle[n];
    real[0] = mean / N;

    for (let k = 1; k < harmonics; k++) {
        let sumCos = 0;
        let sumSin = 0;
        for (let n = 0; n < N; n++) {
            const angle = (2 * Math.PI * k * n) / N;
            const x = cycle[n];
            sumCos += x * Math.cos(angle);
            sumSin += x * Math.sin(angle);
        }
        // Scale to Fourier series coefficients for WebAudio PeriodicWave
        real[k] = (2 / N) * sumCos;
        imag[k] = (2 / N) * sumSin;
    }

    return { real, imag };
}

// -------------------- Multi-window WAV -> multiple wavetables --------------------

/**
 * Extract multiple wavetables from a WAV file using fixed-size windows.
 * Returns an array of { real, imag } of length up to `count`.
 */
export async function wavFileToWavetables(file, options = {}) {
    const {
        harmonics = 32,
        windowSize = 2048,
        count = 10,
        // For general musical audio (not single-period), default to not using autocorrelation.
        useAutocorr = false,
        alignZeroCrossing = true,
        removeDC = true
    } = options;

    const { audioContext } = initAudio();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await decodeArrayBufferToAudioBuffer(audioContext, arrayBuffer);
    const samples = audioBuffer.getChannelData(0);

    if (!samples || samples.length === 0) return [];
    if (samples.length <= windowSize) {
        // Single window fallback
        let window = samples.slice(0, Math.min(samples.length, windowSize));
        if (window.length < windowSize) {
            const padded = new Float32Array(windowSize);
            padded.set(window);
            window = padded;
        }
        const wt = windowToWavetable(window, { harmonics, useAutocorr, alignZeroCrossing, removeDC });
        return [wt];
    }

    const starts = getWindowStartIndicesForCount(samples.length, windowSize, count);
    const results = [];
    for (let i = 0; i < starts.length; i++) {
        const start = starts[i];
        const window = samples.subarray(start, start + windowSize);
        const wt = windowToWavetable(window, { harmonics, useAutocorr, alignZeroCrossing, removeDC });
        results.push(wt);
    }
    return results;
}

function getWindowStartIndicesForCount(totalLength, windowSize, count) {
    if (count <= 1) return [0];
    const usable = totalLength - windowSize;
    if (usable <= 0) return [0];
    const step = Math.max(1, Math.floor(usable / (count - 1)));
    const starts = [];
    for (let i = 0; i < count; i++) {
        const s = Math.min(i * step, totalLength - windowSize);
        starts.push(s);
    }
    return starts;
}

function windowToWavetable(window, { harmonics, useAutocorr, alignZeroCrossing, removeDC }) {
    let data = new Float32Array(window.length);
    data.set(window);

    if (removeDC) {
        let mean = 0;
        for (let i = 0; i < data.length; i++) mean += data[i];
        mean /= data.length;
        for (let i = 0; i < data.length; i++) data[i] -= mean;
    }

    // Optionally try to make it closer to a single-cycle by period estimation,
    // otherwise treat the window as one period after alignment.
    if (useAutocorr) {
        // Reuse existing extractor to get a single cycle from this window.
        // Note: We do not have sampleRate here, but period is in samples and we only care about shape.
        // Use a broad plausible range so autocorr has freedom.
        const single = extractSingleCycle(data, /*sampleRate*/ 48000, { minFrequency: 40, maxFrequency: 4000 });
        return singleCycleToFourier(single, harmonics);
    }

    if (alignZeroCrossing) {
        data = rotateToRisingZeroCrossing(data);
    }

    applyHannInPlace(data);
    return singleCycleToFourier(data, harmonics);
}

function applyHannInPlace(arr) {
    const N = arr.length;
    for (let n = 0; n < N; n++) {
        const w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
        arr[n] *= w;
    }
}

function rotateToRisingZeroCrossing(arr) {
    const N = arr.length;
    let idx = -1;
    for (let i = 0; i < N - 1; i++) {
        const s0 = arr[i];
        const s1 = arr[i + 1];
        if (s0 <= 0 && s1 > 0) { idx = i + 1; break; }
    }
    if (idx <= 0) return arr.slice();
    const out = new Float32Array(N);
    let p = 0;
    for (let i = idx; i < N; i++) out[p++] = arr[i];
    for (let i = 0; i < idx; i++) out[p++] = arr[i];
    return out;
}