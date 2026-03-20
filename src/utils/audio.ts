/**
 * Audio processing utilities for the Live API
 * Mobile-optimized: suspends recording during playback to prevent choppy audio
 */

export class AudioProcessor {
  private recordingContext: AudioContext | null = null;
  private playbackContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private nextStartTime = 0;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private isPlaybackStarted = false;
  private isSpeaking = false;
  private wakeLock: any = null;

  private readonly JITTER_DELAY = 0.15;

  constructor(private onAudioData: (base64Data: string) => void) {}

  private async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
      }
    } catch (e) {}
  }

  private releaseWakeLock() {
    if (this.wakeLock) {
      try { this.wakeLock.release(); } catch (e) {}
      this.wakeLock = null;
    }
  }

  async startRecording() {
    await this.requestWakeLock();

    if (this.recordingContext && this.recordingContext.state !== 'closed') {
      await this.recordingContext.close();
    }
    this.recordingContext = new AudioContext({ sampleRate: 16000 });

    if (this.recordingContext.state === 'suspended') {
      await this.recordingContext.resume();
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000,
      }
    });

    this.source = this.recordingContext.createMediaStreamSource(this.stream);

    const bufferSize = 8192;
    this.scriptNode = this.recordingContext.createScriptProcessor(bufferSize, 1, 1);

    this.scriptNode.onaudioprocess = (e) => {
      if (this.isSpeaking) return;
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmData = this.floatTo16BitPCM(inputData);
      const base64Data = this.arrayBufferToBase64(pcmData.buffer);
      this.onAudioData(base64Data);
    };

    this.source.connect(this.scriptNode);
    this.scriptNode.connect(this.recordingContext.destination);
  }

  private async suspendRecording() {
    if (this.recordingContext && this.recordingContext.state === 'running') {
      try { await this.recordingContext.suspend(); } catch (e) {}
    }
  }

  private async resumeRecording() {
    if (this.recordingContext && this.recordingContext.state === 'suspended') {
      try { await this.recordingContext.resume(); } catch (e) {}
    }
  }

  stopRecording() {
    this.resetPlayback();
    this.releaseWakeLock();

    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.recordingContext && this.recordingContext.state !== 'closed') {
      this.recordingContext.close();
      this.recordingContext = null;
    }
    if (this.playbackContext && this.playbackContext.state !== 'closed') {
      this.playbackContext.close();
      this.playbackContext = null;
    }
    this.isPlaybackStarted = false;
    this.isSpeaking = false;
  }

  private floatTo16BitPCM(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  async playAudioChunk(base64Data: string) {
    if (!this.playbackContext || this.playbackContext.state === 'closed') {
      this.playbackContext = new AudioContext({ sampleRate: 24000 });
      this.nextStartTime = 0;
      this.isPlaybackStarted = false;
    }

    if (this.playbackContext.state === 'suspended') {
      await this.playbackContext.resume();
    }

    const binaryString = window.atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const pcmData = new Int16Array(bytes.buffer);
    const floatData = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      floatData[i] = pcmData[i] / 32768.0;
    }

    const audioBuffer = this.playbackContext.createBuffer(1, floatData.length, 24000);
    audioBuffer.getChannelData(0).set(floatData);

    const bufferSource = this.playbackContext.createBufferSource();
    bufferSource.buffer = audioBuffer;
    bufferSource.connect(this.playbackContext.destination);

    this.isSpeaking = true;
    await this.suspendRecording();

    this.activeSources.add(bufferSource);

    bufferSource.onended = () => {
      this.activeSources.delete(bufferSource);
      if (this.activeSources.size === 0) {
        setTimeout(async () => {
          this.isSpeaking = false;
          await this.resumeRecording();
        }, 400);
      }
    };

    const currentTime = this.playbackContext.currentTime;

    if (!this.isPlaybackStarted) {
      this.nextStartTime = currentTime + this.JITTER_DELAY;
      this.isPlaybackStarted = true;
    } else if (this.nextStartTime < currentTime) {
      this.nextStartTime = currentTime + this.JITTER_DELAY;
    }

    bufferSource.start(this.nextStartTime);
    this.nextStartTime += audioBuffer.duration;
  }

  resetPlayback() {
    this.activeSources.forEach(source => {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {}
    });
    this.activeSources.clear();
    this.nextStartTime = 0;
    this.isPlaybackStarted = false;
    setTimeout(async () => {
      this.isSpeaking = false;
      await this.resumeRecording();
    }, 400);
  }
}
