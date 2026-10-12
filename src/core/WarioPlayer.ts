import { GameBoyPlayer } from '../../src-v2/core/GameBoyPlayer';
import { audioBufferToWavBytes } from '../utils/export';
import { unlockAudio } from '../utils/audioUnlock';

/** Bridges the main player controls to the Game Boy synthesis engine. */
export class WarioPlayer {
  private player: GameBoyPlayer | null = null;
  private volume = 0.7;
  private duration = 0;

  async prepare(buffer: ArrayBuffer): Promise<void> {
    const context = await unlockAudio();
    this.player ??= new GameBoyPlayer({}, context);
    this.player.stop();
    const info = this.player.prepareMIDI(buffer);
    if (!info.noteCount || info.duration <= 0) throw new Error('No playable notes found in this MIDI.');
    this.duration = info.duration;
    this.player.setVolume(this.volume);
  }
  async play(): Promise<void> {
    if (!this.player) return;
    await this.player.resume();
    this.player.playFrom(0);
  }
  stop(): void { this.player?.stop(); }
  seek(progress: number): void { this.player?.playFrom(Math.max(0, Math.min(1, progress)) * this.duration); }
  setVolume(volume: number): void { this.volume = volume; this.player?.setVolume(volume); }
  getDuration(): number { return this.duration; }
  getCurrentTime(): number { return Math.max(0, Math.min(this.duration, this.player?.getElapsedTime() || 0)); }
  getProgress(): number { return this.duration ? this.getCurrentTime() / this.duration : 0; }
  hasGeneratedContent(): boolean { return this.duration > 0; }
  async exportMotifWAVBytes(): Promise<Uint8Array> {
    const buffer = await this.player?.renderToBuffer();
    if (!buffer) throw new Error('Nothing to export.');
    return audioBufferToWavBytes(buffer);
  }
}
