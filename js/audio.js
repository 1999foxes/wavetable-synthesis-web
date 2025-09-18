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