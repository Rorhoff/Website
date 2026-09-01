import Phaser from 'phaser';
import { Net } from '../net';
import { W, H, COLORS, buildTextures } from '../arena';

export class Lobby extends Phaser.Scene {
  private net!: Net;
  private codeText!: Phaser.GameObjects.Text;
  private roster!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;

  constructor() { super('Lobby'); }

  init(data: { net: Net }) { this.net = data.net; }

  create() {
    buildTextures(this);
    this.cameras.main.setBackgroundColor(COLORS.sky);

    this.add.text(W / 2, 96, 'MotherWyrm', {
      fontFamily: 'system-ui, sans-serif', fontSize: '58px', fontStyle: 'bold',
      color: '#efe4d2',
    }).setOrigin(0.5);

    this.add.text(W / 2, 160, `Phones: ${location.origin}/mw/pad/`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: '#8b7a66',
    }).setOrigin(0.5);

    this.codeText = this.add.text(W / 2, 262, '····', {
      fontFamily: 'system-ui, sans-serif', fontSize: '132px', fontStyle: 'bold',
      color: '#7fe3c4',
    }).setOrigin(0.5);

    this.roster = this.add.text(W / 2, 430, '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '24px', color: '#efe4d2',
      align: 'center', lineSpacing: 8,
    }).setOrigin(0.5, 0);

    this.hint = this.add.text(W / 2, H - 70, 'Need one player on each side.', {
      fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: '#8b7a66',
    }).setOrigin(0.5);

    this.net.onCode = (code) => this.codeText.setText(code);
    this.net.onJoin = () => this.redraw();
    this.net.onLeave = () => this.redraw();
    if (this.net.code) this.codeText.setText(this.net.code);
    this.redraw();

    this.input.keyboard?.on('keydown-SPACE', () => this.tryStart());
  }

  private redraw() {
    const line = (team: 'blue' | 'red') =>
      [...this.net.players.values()]
        .filter((p) => p.team === team)
        .map((p) => (p.role === 'mother' ? `★ ${p.name}` : p.name))
        .join('   ') || '(empty)';

    this.roster.setText([
      `Blue   ${line('blue')}`,
      '',
      `Red   ${line('red')}`,
    ]);
  }

  update() {
    const teams = new Set([...this.net.players.values()].map((p) => p.team));
    const ready = teams.size === 2;
    this.hint.setText(ready
      ? 'Either mother presses Action to start.'
      : 'Need one player on each side.');

    if (!ready) return;
    for (const p of this.net.players.values()) {
      if (p.role === 'mother' && p.input.actionEdge) {
        p.input.actionEdge = false;
        this.tryStart();
        return;
      }
    }
  }

  private tryStart() {
    const teams = new Set([...this.net.players.values()].map((p) => p.team));
    if (teams.size < 2) return;
    this.scene.start('Game', { net: this.net });
  }
}
