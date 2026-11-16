// Captcha visuel généré localement (aucun service externe) : caractères déformés + bruit.
const CAPTCHA_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O ni 1/I, trop ambigus

function randomCode(len = 6) {
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => CAPTCHA_CHARS[n % CAPTCHA_CHARS.length]).join("");
}

function drawCaptcha(canvas, code) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const rnd = (min, max) => min + Math.random() * (max - min);
  ctx.clearRect(0, 0, w, h);

  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${rnd(0, 360)} 30% 88%)`);
  g.addColorStop(1, `hsl(${rnd(0, 360)} 30% 80%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = `hsla(${rnd(0, 360)} 40% 40% / .35)`;
    ctx.fillRect(rnd(0, w), rnd(0, h), 2, 2);
  }

  const fonts = ["Georgia", "Courier New", "Verdana", "Trebuchet MS", "Times New Roman"];
  const step = (w - 40) / code.length;
  for (let i = 0; i < code.length; i++) {
    ctx.save();
    ctx.translate(24 + i * step + rnd(-3, 3), h / 2 + rnd(-8, 8));
    ctx.rotate(rnd(-0.45, 0.45));
    ctx.transform(1, rnd(-0.2, 0.2), rnd(-0.3, 0.3), 1, 0, 0);
    ctx.font = `${Math.round(rnd(34, 44))}px ${fonts[Math.floor(rnd(0, fonts.length))]}`;
    ctx.fillStyle = `hsl(${rnd(0, 360)} 55% ${rnd(18, 32)}%)`;
    ctx.textBaseline = "middle";
    ctx.fillText(code[i], 0, 0);
    ctx.restore();
  }

  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = `hsla(${rnd(0, 360)} 50% 30% / .55)`;
    ctx.lineWidth = rnd(1, 2.5);
    ctx.beginPath();
    ctx.moveTo(rnd(0, w * .2), rnd(0, h));
    ctx.bezierCurveTo(rnd(0, w), rnd(0, h), rnd(0, w), rnd(0, h), rnd(w * .8, w), rnd(0, h));
    ctx.stroke();
  }
}
