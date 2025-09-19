import { initAudio, WavetableOscillator, wavFileToWavetables } from './audio.js';
import { startVisualizer } from './visualizer.js';

const playButton = document.getElementById('play');
const canvas = document.getElementById('scope');
const blendSlider = document.getElementById('blend');
const wavInput = document.getElementById('wavimport');

let visualizerStarted = false;
let wavetableOsc = null;
const importedWavetables = [];

playButton.addEventListener('click', async () => {
    const { audioContext, analyser } = initAudio();
    await audioContext.resume();

    if (!wavetableOsc) {
        // Build three basic wavetables: sine, sawtooth, square
        const harmonics = 32;

        const makeZeros = () => ({
            real: new Float32Array(harmonics),
            imag: new Float32Array(harmonics)
        });

        // Sine: imag[1] = 1, others 0
        const sine = makeZeros();
        sine.real[0] = 0;
        sine.imag[1] = 1;

        // Sawtooth: all harmonics, imag[n] = -1/n
        const saw = makeZeros();
        for (let n = 1; n < harmonics; n++) {
            saw.real[n] = 0;
            saw.imag[n] = -1 / n;
        }

        // Square: odd harmonics only, imag[n] = 1/n for odd n
        const square = makeZeros();
        for (let n = 1; n < harmonics; n++) {
            if (n % 2 === 1) {
                square.imag[n] = 1 / n;
            } else {
                square.imag[n] = 0;
            }
        }

        const initialTables = [sine, saw, square, ...importedWavetables];
        wavetableOsc = new WavetableOscillator(audioContext, initialTables, { frequency: 220 });
        wavetableOsc.connect(analyser);
        analyser.connect(audioContext.destination);
        wavetableOsc.start();

        // Initialize with current slider value
        const initial = parseFloat(blendSlider.value);
        if (!Number.isNaN(initial)) {
            wavetableOsc.setPosition(initial);
        }
    }

    if (!visualizerStarted) {
        startVisualizer(canvas, analyser);
        visualizerStarted = true;
    }

    playButton.disabled = true;
});

if (blendSlider) {
    blendSlider.addEventListener('input', (e) => {
        if (!wavetableOsc) return;
        const value = parseFloat(e.target.value);
        if (!Number.isNaN(value)) {
            wavetableOsc.setPosition(value);
        }
    });
}

if (wavInput) {
    wavInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
            const wavetables = await wavFileToWavetables(file, { harmonics: 32, windowSize: 2048, count: 10, useAutocorr: false });
            for (const wt of wavetables) importedWavetables.push(wt);
            if (wavetableOsc) {
                for (const wt of wavetables) wavetableOsc.addWavetable(wt);
                // Move blend near end to audition the newly added windows
                wavetableOsc.setPosition(1);
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('Failed to import WAV as wavetables:', err);
        } finally {
            // reset input so selecting the same file again triggers change
            e.target.value = '';
        }
    });
}
