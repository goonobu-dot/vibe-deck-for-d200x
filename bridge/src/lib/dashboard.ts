/**
 * /dashboard — self-contained live status board (phone / second monitor).
 * Mirrors the deck's visual language: lanes per tool, breathing thinking,
 * urgent input blink, done pop. Polls /status once per second per tool.
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vibe Deck — Dashboard</title>
<style>
  :root{
    --bg:#0d0f13; --tile:#16181d; --line:#262a32; --txt:#e8eaee; --mut:#8b93a1;
    --idle:#d7dae0; --think:#4a9bee; --done:#7bc95c; --input:#f2a33c; --error:#e4544f; --empty:#3a3f48;
  }
  *{box-sizing:border-box;margin:0}
  body{background:var(--bg);color:var(--txt);font:16px/1.5 -apple-system,"Hiragino Sans",sans-serif;padding:22px}
  h1{font-size:16px;letter-spacing:.12em;color:var(--mut);font-weight:600;margin-bottom:18px}
  h1 .dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--done);margin-right:8px}
  h1 .dot.down{background:var(--error)}
  .tool{margin-bottom:22px;border:1px solid var(--line);border-radius:14px;padding:14px 16px;border-left-width:4px}
  .tool[data-t=claude]{border-left-color:#a78bfa}
  .tool[data-t=codex]{border-left-color:#2dd4bf}
  .tool[data-t=cursor]{border-left-color:#4c8dff}
  .tname{font-size:13px;letter-spacing:.1em;color:var(--mut);text-transform:uppercase;margin-bottom:10px}
  .lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
  .lane{background:var(--tile);border:1px solid var(--line);border-radius:10px;padding:10px 12px;min-height:86px;
        display:flex;flex-direction:column;gap:4px;overflow:hidden}
  .bar{height:5px;border-radius:3px;background:var(--empty);width:60%}
  .st{font-size:13px;font-weight:600;letter-spacing:.04em;color:var(--mut)}
  .nm{font-size:13px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tm{font-size:12px;color:#6b7280;font-variant-numeric:tabular-nums}
  @keyframes breathe{0%,100%{opacity:.35}50%{opacity:1}}
  @keyframes urgent{0%,100%{background:var(--tile)}50%{background:#3a2705}}
  @keyframes pop{0%{transform:scale(1)}30%{transform:scale(1.14)}100%{transform:scale(1)}}
  .lane.thinking .bar{background:var(--think);animation:breathe 1.6s ease-in-out infinite}
  .lane.thinking .st{color:var(--think)}
  .lane.needs_input{animation:urgent 1s ease-in-out infinite;border-color:var(--input)}
  .lane.needs_input .bar{background:var(--input)}
  .lane.needs_input .st{color:var(--input)}
  .lane.done .bar{background:var(--done)}
  .lane.done .st{color:var(--done)}
  .lane.done.fresh{animation:pop .5s ease-out 1}
  .lane.idle .bar{background:#565c66}
  .lane.error{border-color:var(--error)}
  .lane.error .bar{background:var(--error)}
  .lane.error .st{color:var(--error)}
  .note{font-size:12px;color:#59606c;margin-top:6px}
</style>
</head>
<body>
<h1><span class="dot" id="health"></span>VIBE DECK — LIVE</h1>
<div id="board"></div>
<script>
const TOOLS = ["claude", "codex", "cursor"];
const LABEL = { idle:"Idle", thinking:"Thinking", done:"Done", needs_input:"Approve?", error:"Error", empty:"Ready" };
const prev = {};
function laneHtml(tool, a){
  const state = a.state || "empty";
  const key = tool + ":" + a.slot;
  const fresh = state === "done" && prev[key] && prev[key] !== "done" ? " fresh" : "";
  prev[key] = state;
  const title = a.title ? String(a.title).slice(0, 26) : "\\u2014";
  const age = a.updatedAt ? Math.max(0, Math.round((Date.now() - a.updatedAt) / 1000)) : null;
  const tm = age === null ? "" : age < 60 ? age + "s" : Math.floor(age/60) + "m" + (age%60) + "s";
  return '<div class="lane ' + state + fresh + '"><div class="bar"></div>' +
    '<span class="st">' + (LABEL[state] || state) + '</span>' +
    '<span class="nm">' + title.replace(/[<>&]/g, "") + '</span>' +
    '<span class="tm">' + tm + '</span></div>';
}
async function tick(){
  let ok = false;
  const parts = [];
  for (const tool of TOOLS){
    try {
      const r = await fetch("/status?tool=" + tool);
      const d = await r.json();
      ok = true;
      const lanes = (d.agents || []).slice(0, 5).map(a => laneHtml(tool, a)).join("");
      parts.push('<div class="tool" data-t="' + tool + '"><div class="tname">' + tool +
        '</div><div class="lanes">' + lanes + '</div><div class="note">' + (d.note || "") + '</div></div>');
    } catch (e) {
      parts.push('<div class="tool" data-t="' + tool + '"><div class="tname">' + tool +
        '</div><div class="note">bridge unreachable</div></div>');
    }
  }
  document.getElementById("board").innerHTML = parts.join("");
  document.getElementById("health").className = "dot" + (ok ? "" : " down");
}
tick();
setInterval(tick, 1000);
</script>
</body>
</html>`;
