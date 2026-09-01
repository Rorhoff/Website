import Phaser from 'phaser';
import { Net, Lobbyist, Team } from '../net';
import { updateBotBrains, type BotWorld } from '../bots';
import { applyLocalKeyboard } from '../local-input';
import {
  actorAtlasKey,
  actorTextureKey,
  applySpriteScale,
  gemTextureKey,
  getGemAnchor,
  mountBackground,
  tryPlayAnim,
  wyrmTextureKey,
} from '../assets';
import { SPRITE_SCALE } from '../asset-manifest';
import { drawCollisionOverlay } from '../collision-overlay';
import {
  W, H, COLORS, TUNING, PLATFORMS, GEM_SPAWNS, SPAWN,
  SLOT_SIZE, HOARD_Y, slotRect,
} from '../arena';

type Sprite = Phaser.Physics.Arcade.Sprite;

interface Actor extends Lobbyist {
  sprite: Sprite;
  atlasKey: string;
  facing: 1 | -1;
  carrying: number;
  carriedGem?: Phaser.GameObjects.Image;
  hp: number;
  deaths: number;
  stunUntil: number;
  invulnUntil: number;
  deadUntil: number;
  attackUntil: number;
  attackDir: Phaser.Math.Vector2;
  diving: boolean;
  puntUntil: number;
  riding: boolean;
  label: Phaser.GameObjects.Text;
}

const OTHER: Record<Team, Team> = { blue: 'red', red: 'blue' };
const HEX: Record<Team, string> = { blue: '#4aa3d8', red: '#e0663f' };

export class Game extends Phaser.Scene {
  private net!: Net;
  private actors: Actor[] = [];
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private gems!: Phaser.Physics.Arcade.Group;
  private slots: Record<Team, boolean[]> = { blue: [], red: [] };
  private slotGfx!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;

  private wyrm!: Phaser.Physics.Arcade.Image;
  private wyrmGfx!: Phaser.GameObjects.Graphics;

  private hudBlue!: Phaser.GameObjects.Text;
  private hudRed!: Phaser.GameObjects.Text;
  private hudWyrm!: Phaser.GameObjects.Text;
  private over = false;
  private showCollision = false;
  private collisionGfx!: Phaser.GameObjects.Graphics;

  constructor() { super('Game'); }

  init(data: { net: Net }) { this.net = data.net; }

  // ------------------------------------------------------------------ setup

  create() {
    this.over = false;
    this.actors = [];
    this.slots = { blue: new Array(TUNING.slotsToWin).fill(false), red: new Array(TUNING.slotsToWin).fill(false) };
    this.cameras.main.setBackgroundColor(COLORS.sky);
    this.physics.world.setBounds(0, 0, W, H);

    mountBackground(this);
    this.collisionGfx = this.add.graphics().setDepth(100).setVisible(false);

    this.buildPlatforms();
    this.slotGfx = this.add.graphics();
    this.drawSlots();

    this.gems = this.physics.add.group({ bounceX: 0.35, bounceY: 0.3, dragX: 140 });
    this.physics.add.collider(this.gems, this.platforms);
    GEM_SPAWNS.forEach((_, i) => this.spawnGem(i));

    this.buildWyrm();
    this.buildActors();

    this.fx = this.add.graphics();
    const hudStyle = { fontFamily: 'system-ui, sans-serif', fontSize: '21px', lineSpacing: 4 };
    this.hudBlue = this.add.text(28, 18, '', { ...hudStyle, color: HEX.blue }).setDepth(50);
    this.hudRed = this.add.text(W - 28, 18, '', { ...hudStyle, color: HEX.red })
      .setOrigin(1, 0).setDepth(50);
    this.hudWyrm = this.add.text(W / 2, 18, '', { ...hudStyle, color: '#c9a25e', align: 'center' })
      .setOrigin(0.5, 0).setDepth(50);

    this.net.onLeave = (pid) => {
      const i = this.actors.findIndex((a) => a.pid === pid);
      if (i >= 0) {
        this.actors[i].carriedGem?.destroy();
        this.actors[i].sprite.destroy();
        this.actors[i].label.destroy();
        this.actors.splice(i, 1);
      }
    };

    this.input.keyboard?.on('keydown-F3', () => {
      this.showCollision = !this.showCollision;
      this.collisionGfx.setVisible(this.showCollision);
      if (this.showCollision) drawCollisionOverlay(this.collisionGfx);
    });
  }

  private buildPlatforms() {
    this.platforms = this.physics.add.staticGroup();
    PLATFORMS.forEach(([x, y, w, h], idx) => {
      const r = this.add.rectangle(x + w / 2, y + h / 2, w, h, COLORS.soil)
        .setStrokeStyle(2, COLORS.soilLip);
      this.platforms.add(r);
      const body = r.body as Phaser.Physics.Arcade.StaticBody;
      body.updateFromGameObject();
      // Everything except the ground is a drop-through ledge, so a whelp
      // can pop up from below instead of bonking its cap.
      if (idx > 0) {
        body.checkCollision.down = false;
        body.checkCollision.left = false;
        body.checkCollision.right = false;
      }
    });
  }

  private buildWyrm() {
    this.wyrmGfx = this.add.graphics();
    const key = wyrmTextureKey();
    this.wyrm = this.physics.add.image(W / 2, 655, key).setVisible(false);
    applySpriteScale(this.wyrm);
    const wb = this.wyrm.body as Phaser.Physics.Arcade.Body;
    wb.setSize(150, 34);
    wb.setAllowGravity(false);
    this.wyrm.setImmovable(true);
  }

  private buildActors() {
    for (const p of this.net.players.values()) {
      const atlasKey = actorAtlasKey(p.role, p.team);
      const key = actorTextureKey(p.role, p.team);
      const spawn = SPAWN[p.team];
      const sprite = this.physics.add.sprite(spawn.x, spawn.y, key);
      applySpriteScale(sprite);
      sprite.setCollideWorldBounds(true);
      (sprite.body as Phaser.Physics.Arcade.Body).setGravityY(
        p.role === 'mother' ? TUNING.motherGravity - TUNING.gravity : 0
      );
      this.physics.add.collider(sprite, this.platforms);

      const label = this.add.text(0, 0, p.name, {
        fontFamily: 'system-ui, sans-serif', fontSize: '13px', color: HEX[p.team],
      }).setOrigin(0.5, 1).setDepth(40);

      this.actors.push({
        ...p, sprite, atlasKey, label,
        facing: p.team === 'blue' ? 1 : -1,
        carrying: 0,
        hp: TUNING.motherHp,
        deaths: 0,
        stunUntil: 0, invulnUntil: 0, deadUntil: 0,
        attackUntil: 0, attackDir: new Phaser.Math.Vector2(1, 0),
        diving: false, puntUntil: 0, riding: false,
      });
    }
  }

  private spawnGem(index: number) {
    const [x, y] = GEM_SPAWNS[index];
    const key = gemTextureKey();
    const c = this.gems.create(x, y, key) as Sprite;
    if (key === 'props') c.setFrame(0);
    c.setData('spawn', index);
    c.setCollideWorldBounds(true);
  }

  // ----------------------------------------------------------------- update

  update(time: number, delta: number) {
    if (this.over) return;

    applyLocalKeyboard(this.net, this.input.keyboard);
    updateBotBrains(this.buildBotWorld(time));

    for (const a of this.actors) this.updateActor(a, time, delta);

    this.updateWyrm();
    this.updateGems(time);
    this.resolveCombat(time);
    this.drawWyrm();
    this.drawHud();
    this.checkWin();

    // Edge flags live exactly one frame.
    for (const a of this.actors) { a.input.jumpEdge = false; a.input.actionEdge = false; }
  }

  private buildBotWorld(time: number): BotWorld {
    const slotCount = (t: Team) => this.slots[t].filter(Boolean).length;
    const gems: Array<{ x: number; y: number }> = [];
    for (const child of this.gems.getChildren()) {
      const s = child as Sprite;
      if (s.active) gems.push({ x: s.x, y: s.y });
    }
    return {
      time,
      wyrmX: this.wyrm.x,
      slotsFilled: { blue: slotCount('blue'), red: slotCount('red') },
      gems,
      actors: this.actors.map((a) => {
        const body = a.sprite.body as Phaser.Physics.Arcade.Body;
        return {
          pid: a.pid,
          team: a.team,
          role: a.role,
          x: a.sprite.x,
          y: a.sprite.y,
          vy: body.velocity.y,
          onGround: body.blocked.down || body.touching.down,
          carrying: a.carrying,
          riding: a.riding,
          deadUntil: a.deadUntil,
          stunUntil: a.stunUntil,
          input: a.input,
          bot: a.bot,
        };
      }),
    };
  }

  private updateActor(a: Actor, time: number, _delta: number) {
    const body = a.sprite.body as Phaser.Physics.Arcade.Body;

    // Dead mother: parked off-screen until the respawn timer fires.
    if (a.deadUntil > time) { a.label.setVisible(false); return; }
    if (a.deadUntil !== 0 && a.deadUntil <= time) {
      a.deadUntil = 0;
      a.hp = TUNING.motherHp;
      a.invulnUntil = time + TUNING.motherInvulnMs;
      a.sprite.setPosition(SPAWN[a.team].x, SPAWN[a.team].y).setVisible(true);
      body.enable = true;
      body.setVelocity(0, 0);
    }

    a.label.setVisible(true).setPosition(a.sprite.x, a.sprite.y - a.sprite.displayHeight / 2 - 4);
    a.sprite.setAlpha(a.invulnUntil > time ? 0.55 : 1);

    if (a.role === 'whelp') {
      this.syncCarriedGem(a);
      if (a.stunUntil <= time && a.deadUntil <= time) {
        if (!body.blocked.down) {
          tryPlayAnim(a.sprite, a.atlasKey, body.velocity.y < 0 ? 'jump' : 'fall');
        } else if (Math.abs(a.input.x) > 0.3) {
          tryPlayAnim(a.sprite, a.atlasKey, 'run');
        } else {
          tryPlayAnim(a.sprite, a.atlasKey, 'idle');
        }
      }
      if (a.carrying > 0) {
        a.label.setText(`${a.name} ◆`);
      } else {
        a.label.setText(a.name);
      }
    }

    if (a.stunUntil > time) { a.sprite.setAngle(Math.sin(time / 40) * 14); return; }
    a.sprite.setAngle(0);

    if (Math.abs(a.input.x) > 0.3) a.facing = a.input.x > 0 ? 1 : -1;
    a.sprite.setFlipX(a.facing < 0);

    if (a.riding) { this.updateRider(a); return; }

    if (a.role === 'mother') this.updateMother(a, time, body);
    else this.updateWhelp(a, time, body);
  }

  private updateWhelp(a: Actor, time: number, body: Phaser.Physics.Arcade.Body) {
    body.setVelocityX(a.input.x * TUNING.whelpSpeed);

    if (a.input.jumpEdge && body.blocked.down) body.setVelocityY(TUNING.whelpJump);

    // Punting and throwing are airborne moves. That is the timing window.
    if (a.input.actionEdge && !body.blocked.down) {
      if (a.carrying > 0) {
        a.carrying--;
        const key = gemTextureKey();
        const c = this.gems.create(a.sprite.x + a.facing * 20, a.sprite.y - 10, key) as Sprite;
        if (key === 'props') c.setFrame(0);
        c.setData('spawn', Phaser.Math.Between(0, GEM_SPAWNS.length - 1));
        c.setCollideWorldBounds(true);
        c.setVelocity(a.facing * TUNING.throwPower, -320);
        this.syncCarriedGem(a);
      } else {
        a.puntUntil = time + TUNING.puntWindowMs;
      }
    }

    if (a.puntUntil > time) this.resolvePunt(a);
  }

  private updateMother(a: Actor, time: number, body: Phaser.Physics.Arcade.Body) {
    if (a.diving) {
      body.setVelocityY(TUNING.diveSpeed);
      body.setVelocityX(a.input.x * TUNING.motherSpeed * 0.6);
      if (body.blocked.down) { a.diving = false; this.diveImpact(a); }
      return;
    }

    body.setVelocityX(a.input.x * TUNING.motherSpeed);

    // Jetpack: every tap is a discrete impulse, capped so mashing has a ceiling.
    if (a.input.jumpEdge) {
      body.setVelocityY(Math.max(body.velocity.y + TUNING.motherThrust, TUNING.motherThrustCap));
      this.puff(a.sprite.x, a.sprite.y + 22);
    }

    if (a.input.actionEdge) {
      if (a.input.y > 0.5 && !body.blocked.down) {
        a.diving = true;
        a.attackUntil = time + 600;
        a.attackDir.set(0, 1);
      } else {
        const dir = a.input.x < -0.5 ? -1 : a.input.x > 0.5 ? 1 : a.facing;
        a.facing = dir as 1 | -1;
        a.attackDir.set(dir, 0);
        a.attackUntil = time + TUNING.swipeMs;
      }
    }
  }

  private updateRider(a: Actor) {
    const body = a.sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    const riders = this.actors.filter((r) => r.riding);
    const i = riders.indexOf(a);
    const spread = (i - (riders.length - 1) / 2) * 34;
    a.sprite.setPosition(this.wyrm.x + spread, this.wyrm.y - 30);
    body.setVelocity(0, 0);

    if (a.input.jumpEdge) this.dismount(a, -480);
  }

  private dismount(a: Actor, vy: number) {
    a.riding = false;
    const body = a.sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(true);
    body.setVelocityY(vy);
  }

  // ------------------------------------------------------------------- wyrm

  private updateWyrm() {
    const riders = this.actors.filter((r) => r.riding);

    // Whoever is aboard steers. Two teams pulling opposite ways cancel out,
    // so a contested wyrm just sits there and the fight decides it.
    const pull = riders.reduce((s, r) => s + r.input.x, 0);
    this.wyrm.setVelocityX(Phaser.Math.Clamp(pull, -1, 1) * TUNING.wyrmSpeed);
    this.wyrm.x = Phaser.Math.Clamp(this.wyrm.x, 40, W - 40);

    // Mount by landing on the wyrm's back.
    for (const a of this.actors) {
      if (a.riding || a.role === 'mother' || a.stunUntil > this.time.now) continue;
      const body = a.sprite.body as Phaser.Physics.Arcade.Body;
      if (body.velocity.y < 0) continue;
      if (Math.abs(a.sprite.x - this.wyrm.x) < 80 &&
          Math.abs(a.sprite.y - (this.wyrm.y - 30)) < 26) {
        a.riding = true;
      }
    }
  }

  // --------------------------------------------------------------- gems

  private updateGems(_time: number) {
    for (const obj of this.gems.getChildren() as Sprite[]) {
      if (!obj.active) continue;
      const bounds = obj.getBounds();

      // A gem that lands in an empty slot fills it, whoever threw it.
      let consumed = false;
      for (const team of ['blue', 'red'] as Team[]) {
        for (let i = 0; i < TUNING.slotsToWin; i++) {
          if (this.slots[team][i]) continue;
          if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, slotRect(team, i))) {
            this.slots[team][i] = true;
            this.recycle(obj);
            this.drawSlots();
            consumed = true;
            break;
          }
        }
        if (consumed) break;
      }
      if (consumed) continue;

      // Otherwise a whelp with room in its arms scoops it up on contact.
      for (const a of this.actors) {
        if (a.role === 'mother' || a.carrying >= TUNING.carryMax) continue;
        if (a.stunUntil > this.time.now || a.deadUntil > 0) continue;
        if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, a.sprite.getBounds())) {
          a.carrying++;
          this.recycle(obj);
          this.syncCarriedGem(a);
          break;
        }
      }
    }

    // Running across your own empty slot deposits one without any aiming.
    for (const a of this.actors) {
      if (a.role === 'mother' || a.carrying === 0) continue;
      for (let i = 0; i < TUNING.slotsToWin; i++) {
        if (this.slots[a.team][i]) continue;
        if (Phaser.Geom.Intersects.RectangleToRectangle(a.sprite.getBounds(), slotRect(a.team, i))) {
          this.slots[a.team][i] = true;
          a.carrying--;
          this.drawSlots();
          this.syncCarriedGem(a);
          break;
        }
      }
    }
  }

  private recycle(obj: Sprite) {
    const idx = obj.getData('spawn') as number;
    obj.destroy();
    this.time.delayedCall(TUNING.gemRespawnMs, () => {
      if (!this.over) this.spawnGem(idx);
    });
  }

  private dropOneCarried(a: Actor) {
    if (a.carrying <= 0) return;
    a.carrying--;
    const key = gemTextureKey();
    const c = this.gems.create(a.sprite.x, a.sprite.y - 12, key) as Sprite;
    if (key === 'props') c.setFrame(0);
    c.setData('spawn', Phaser.Math.Between(0, GEM_SPAWNS.length - 1));
    c.setCollideWorldBounds(true);
    c.setVelocity(Phaser.Math.Between(-260, 260), -340);
    this.syncCarriedGem(a);
  }

  private dropCarried(a: Actor) {
    while (a.carrying > 0) this.dropOneCarried(a);
  }

  private syncCarriedGem(a: Actor) {
    if (a.role === 'mother') return;
    if (a.carrying > 0) {
      if (!a.carriedGem) {
        const key = gemTextureKey();
        a.carriedGem = this.add.image(0, 0, key);
        if (key === 'props') a.carriedGem.setFrame(0);
        a.carriedGem.setScale(SPRITE_SCALE);
        a.carriedGem.setDepth(a.sprite.depth + 1);
      }
      a.carriedGem.setVisible(true);
      const anchor = getGemAnchor(a.atlasKey);
      a.carriedGem.setPosition(
        a.sprite.x + anchor.x * SPRITE_SCALE * a.facing,
        a.sprite.y + anchor.y * SPRITE_SCALE
      );
    } else {
      a.carriedGem?.setVisible(false);
    }
  }

  // ---------------------------------------------------------------- combat

  private resolvePunt(a: Actor) {
    const reach = TUNING.puntReach;

    for (const obj of this.gems.getChildren() as Sprite[]) {
      if (!obj.active) continue;
      if (Phaser.Math.Distance.Between(a.sprite.x, a.sprite.y, obj.x, obj.y) > reach) continue;
      obj.setVelocity(a.facing * TUNING.puntPower, -380);
      a.puntUntil = 0;
      this.puff(obj.x, obj.y);
      return;
    }

    for (const t of this.actors) {
      if (t.team === a.team || t.carrying === 0) continue;
      if (Phaser.Math.Distance.Between(a.sprite.x, a.sprite.y, t.sprite.x, t.sprite.y) > reach) continue;
      this.dropOneCarried(t);
      a.puntUntil = 0;
      this.puff(t.sprite.x, t.sprite.y);
      return;
    }
  }

  private resolveCombat(time: number) {
    for (const a of this.actors) {
      if (a.role !== 'mother' || a.attackUntil <= time || a.deadUntil > 0) continue;

      const hx = a.sprite.x + a.attackDir.x * TUNING.swipeReach;
      const hy = a.sprite.y + a.attackDir.y * TUNING.swipeReach;

      for (const t of this.actors) {
        if (t.team === a.team || t.invulnUntil > time || t.deadUntil > 0) continue;
        if (Phaser.Math.Distance.Between(hx, hy, t.sprite.x, t.sprite.y) > 52) continue;

        if (t.role === 'mother') this.hurtMother(t, time, a.attackDir.x || a.facing);
        else this.stun(t, time, a.attackDir.x || a.facing);
      }
    }

    // Regular whelps take the mother down by dropping on its back. That is the
    // only way a non-mother can put a dent in one, so the little guys matter.
    for (const m of this.actors) {
      if (m.role === 'mother' || m.riding || m.deadUntil > 0) continue;
      const mb = m.sprite.body as Phaser.Physics.Arcade.Body;
      if (mb.velocity.y <= 40) continue;

      for (const b of this.actors) {
        if (b.role !== 'mother' || b.team === m.team || b.invulnUntil > time || b.deadUntil > 0) continue;
        if (Math.abs(m.sprite.x - b.sprite.x) > 36) continue;
        if (m.sprite.y > b.sprite.y - 8) continue;
        this.hurtMother(b, time, 0);
        mb.setVelocityY(-420);
      }
    }
  }

  private stun(t: Actor, time: number, dir: number) {
    t.stunUntil = time + TUNING.stunMs;
    t.invulnUntil = time + TUNING.stunMs + 300;
    if (t.riding) this.dismount(t, -260);
    (t.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(dir * 300, -260);
    this.dropCarried(t);
    this.net.cue(t.pid, 'Knocked loose. Hang on.');
  }

  private hurtMother(b: Actor, time: number, dir: number) {
    b.hp--;
    b.invulnUntil = time + 700;
    (b.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(dir * 340, -300);
    this.puff(b.sprite.x, b.sprite.y);

    if (b.hp > 0) { this.net.cue(b.pid, `Hit. ${b.hp} left.`); return; }

    b.deaths++;
    b.deadUntil = time + TUNING.motherRespawnMs;
    b.diving = false;
    b.sprite.setVisible(false);
    (b.sprite.body as Phaser.Physics.Arcade.Body).enable = false;
    this.net.cue(b.pid, `Down ${b.deaths} of ${TUNING.motherDeathsToWin}. Back in 3.`);
  }

  private diveImpact(a: Actor) {
    this.puff(a.sprite.x, a.sprite.y + 20);
    this.cameras.main.shake(140, 0.006);

    // Landing on the enemy hoard pops a gem back out of a filled slot.
    for (let i = 0; i < TUNING.slotsToWin; i++) {
      const enemy = OTHER[a.team];
      if (!this.slots[enemy][i]) continue;
      const r = slotRect(enemy, i);
      if (Math.abs(a.sprite.x - (r.x + r.width / 2)) > 90) continue;
      if (Math.abs(a.sprite.y - (r.y + r.height / 2)) > 120) continue;
      this.slots[enemy][i] = false;
      const key = gemTextureKey();
      const c = this.gems.create(r.x + r.width / 2, r.y - 20, key) as Sprite;
      if (key === 'props') c.setFrame(0);
      c.setData('spawn', Phaser.Math.Between(0, GEM_SPAWNS.length - 1));
      c.setCollideWorldBounds(true);
      c.setVelocity(Phaser.Math.Between(-300, 300), -420);
      this.drawSlots();
      break;
    }

    // And it shakes riders loose if it lands near the wyrm.
    for (const r of this.actors) {
      if (!r.riding || r.team === a.team) continue;
      if (Math.abs(r.sprite.x - a.sprite.x) > 140) continue;
      this.dismount(r, -300);
      this.stun(r, this.time.now, Math.sign(r.sprite.x - a.sprite.x) || 1);
    }
  }

  // -------------------------------------------------------------- rendering

  private drawSlots() {
    this.slotGfx.clear();
    for (const team of ['blue', 'red'] as Team[]) {
      for (let i = 0; i < TUNING.slotsToWin; i++) {
        const r = slotRect(team, i);
        if (this.slots[team][i]) {
          this.slotGfx.fillStyle(COLORS.gem, 1);
          this.slotGfx.fillRect(r.x + 3, r.y + 3, r.width - 6, r.height - 6);
        } else {
          this.slotGfx.lineStyle(2, team === 'blue' ? COLORS.blue : COLORS.red, 0.5);
          this.slotGfx.strokeRect(r.x, r.y, r.width, r.height);
        }
      }
      // shelf the slots sit on, so you can run along it
      this.slotGfx.fillStyle(COLORS.soilLip, 1);
      this.slotGfx.fillRect(slotRect(team, 0).x - 6, HOARD_Y + SLOT_SIZE, 15 * 24 + 12, 6);
    }
  }

  private drawWyrm() {
    this.wyrmGfx.clear();
    this.wyrmGfx.fillStyle(COLORS.wyrm, 1);
    for (let i = 0; i < 5; i++) {
      const x = this.wyrm.x - 60 + i * 30;
      const y = this.wyrm.y + Math.sin(this.time.now / 220 + i * 0.9) * 5;
      this.wyrmGfx.fillCircle(x, y, 16 - Math.abs(i - 2) * 1.5);
    }
    this.wyrmGfx.fillStyle(0x241a12, 1);
    const eye = (this.wyrm.body as Phaser.Physics.Arcade.Body).velocity.x >= 0 ? 8 : -8;
    this.wyrmGfx.fillCircle(this.wyrm.x + 60 * Math.sign(eye) + eye * 0.4, this.wyrm.y - 5, 3);
  }

  private puff(x: number, y: number) {
    const g = this.add.circle(x, y, 6, COLORS.bone, 0.6);
    this.tweens.add({ targets: g, radius: 26, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  private drawHud() {
    const count = (t: Team) => this.slots[t].filter(Boolean).length;
    const mother = (t: Team) => this.actors.find((a) => a.role === 'mother' && a.team === t);
    const pips = (t: Team) => {
      const d = mother(t)?.deaths ?? 0;
      return '●'.repeat(d) + '○'.repeat(Math.max(0, TUNING.motherDeathsToWin - d));
    };
    const line = (t: Team) => [
      `Gems ${count(t)}/${TUNING.slotsToWin}`,
      `Mother down ${pips(t)}`,
    ];

    this.hudBlue.setText(line('blue'));
    this.hudRed.setText(line('red'));

    // The wyrm bar reads left to right: red is dragging it left, blue right.
    const pct = Phaser.Math.Clamp((this.wyrm.x - 60) / (W - 120), 0, 1);
    const cells = 21;
    const at = Math.round(pct * (cells - 1));
    this.hudWyrm.setText([
      'Wyrm',
      Array.from({ length: cells }, (_, i) => (i === at ? '◆' : '·')).join(''),
    ]);
  }

  // ------------------------------------------------------------------- win

  private checkWin() {
    const finish = (team: Team, why: string) => {
      this.over = true;
      this.physics.pause();
      this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.72).setDepth(90);
      this.add.text(W / 2, H / 2 - 40, `${team.toUpperCase()} WINS`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '84px', fontStyle: 'bold', color: HEX[team],
      }).setOrigin(0.5).setDepth(91);
      this.add.text(W / 2, H / 2 + 40, why, {
        fontFamily: 'system-ui, sans-serif', fontSize: '26px', color: '#efe4d2',
      }).setOrigin(0.5).setDepth(91);
      for (const a of this.actors) this.net.cue(a.pid, a.team === team ? 'You won.' : 'Next round.');
      this.time.delayedCall(8000, () => this.scene.start('Lobby', { net: this.net }));
    };

    for (const team of ['blue', 'red'] as Team[]) {
      if (this.slots[team].every(Boolean)) return finish(team, 'All fifteen gems hoarded.');

      const enemyMother = this.actors.find((a) => a.role === 'mother' && a.team === OTHER[team]);
      if (enemyMother && enemyMother.deaths >= TUNING.motherDeathsToWin) {
        return finish(team, `Mother whelp put down ${TUNING.motherDeathsToWin} times.`);
      }
    }

    if (this.wyrm.x >= TUNING.wyrmWin.blue) return finish('blue', 'Rode the wyrm across the line.');
    if (this.wyrm.x <= TUNING.wyrmWin.red) return finish('red', 'Rode the wyrm across the line.');
  }
}
