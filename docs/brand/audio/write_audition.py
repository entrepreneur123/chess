"""Write public/audio/audition.html: a standalone page to audition every voice line.

Usage:  python3 write_audition.py   (paths are resolved from this file)
Reads lines.json (script, character notes) and qa-voice.json (measurements of the shipped files).
The page has no external requests: inline CSS, a same-origin audition.js (the site CSP blocks
inline scripts), clips referenced relative to /audio/.
"""
import html
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PUB = os.path.join(ROOT, "public", "audio")
NAMES = {"sad": ("사드", "Paladin"), "marki": ("마르키", "Minotaur"), "walk": ("월크", "Shield soldier"),
         "insaner": ("인세이너", "Imp"), "brutile": ("브루타일", "Witch")}
EVENT_KO = {"select": "선택", "move": "이동", "capture": "잡기", "skill": "스킬", "chain": "연속",
            "death": "사망", "victory": "승리"}

CSS = """
:root{color-scheme:dark;--bg:#0f1117;--card:#181b24;--line:#272b38;--text:#e8eaf0;--mute:#9aa1b2;--acc:#8fb3ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);
font:15px/1.5 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 64px}h1{font-size:22px;margin:0 0 4px}
.sub{color:var(--mute);margin:0 0 20px;font-size:13px}nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
nav a{color:var(--acc);text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:20px}
h2{margin:0;font-size:18px}.role{color:var(--mute);font-size:13px;margin:2px 0 8px}
.note{font-size:13px;color:var(--mute);margin:0 0 12px}
.row{display:grid;grid-template-columns:72px 1fr 260px;gap:12px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}
.ev{font-size:12px;color:var(--acc)}.txt{font-size:16px}.meta{font-size:11px;color:var(--mute)}
audio{width:100%;height:36px}
button{background:#232838;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer}
@media (max-width:640px){.row{grid-template-columns:1fr}.ev{order:-1}}
"""

JS = """
document.querySelectorAll('button[data-play]').forEach(function(b){b.addEventListener('click',function(){
  var list=Array.prototype.slice.call(document.querySelectorAll('#'+b.dataset.play+' audio'));var i=0;
  function next(){if(i>=list.length)return;var a=list[i++];a.currentTime=0;a.play();a.onended=function(){setTimeout(next,350)};}
  document.querySelectorAll('audio').forEach(function(a){a.pause();a.onended=null});next();});});
document.addEventListener('play',function(e){document.querySelectorAll('audio').forEach(function(a){if(a!==e.target)a.pause()})},true);
"""


def main() -> None:
    spec = json.load(open(os.path.join(HERE, "lines.json"), encoding="utf-8"))
    qa = json.load(open(os.path.join(HERE, "qa-voice.json"), encoding="utf-8"))
    out = ["<!doctype html>", '<html lang="ko"><head><meta charset="utf-8">',
           '<meta name="viewport" content="width=device-width,initial-scale=1">',
           "<title>GRID CLASH Voice Audition</title>", f"<style>{CSS}</style></head><body><main>",
           "<h1>GRID CLASH 보이스 오디션</h1>",
           '<p class="sub">캐릭터별 전체 대사. 각 줄 오른쪽 값: 길이 · 라우드니스(LUFS) · 중앙 피치(F0) · 음성인식 오류율(CER).</p>',
           "<nav>" + "".join(f'<a href="#{c}">{NAMES[c][0]}</a>' for c in spec["characters"]) + "</nav>"]
    for char, c in spec["characters"].items():
        ko, en = NAMES.get(char, (char, ""))
        out.append(f'<section id="{char}"><h2>{ko} <span class="meta">{char}</span></h2>')
        out.append(f'<div class="role">{html.escape(en)}</div>')
        if c.get("concept"):
            out.append(f'<p class="note">{html.escape(c["concept"])}</p>')
        out.append(f'<button data-play="{char}">전체 연속 재생</button>')
        for line in c["lines"]:
            name = f"{char}-{line['id']}"
            if not os.path.exists(os.path.join(PUB, "vo", name + ".m4a")):
                continue
            r = qa.get(name, {})
            meta = (f"{r.get('dur', 0):.2f}s · {r.get('lufs', 0):.1f} LUFS · F0 {r.get('f0', 0):.0f} Hz · "
                    f"CER {r.get('cer', 0):.2f}") if r else ""
            out.append('<div class="row">'
                       f'<div class="ev">{EVENT_KO.get(line["event"], line["event"])}<br>'
                       f'<span class="meta">{line["event"]} · {line["id"]}</span></div>'
                       f'<div><div class="txt">{html.escape(line["text"])}</div><div class="meta">{meta}</div></div>'
                       f'<audio controls preload="none" src="vo/{name}.m4a"></audio></div>')
        out.append("</section>")
    out += ["</main>", '<script src="audition.js"></script>', "</body></html>", ""]
    path = os.path.join(PUB, "audition.html")
    open(path, "w", encoding="utf-8").write("\n".join(out))
    open(os.path.join(os.path.dirname(path), "audition.js"), "w", encoding="utf-8").write(JS.strip() + "\n")
    print("wrote", path)


if __name__ == "__main__":
    main()
