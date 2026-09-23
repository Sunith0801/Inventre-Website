"""Tiny SVG diagram DSL: big type, few boxes, consistent brand styling."""
from html import escape as e
BR='#E47127'; INK='#0A0A0A'; MUTE='#5B5B5B'; LINE='#B9B9B9'; CREAM='#FAF7F2'; BORD='#D6D0C6'; BR50='#FEF3EC'; BR100='#F9C49F'
class D:
    def __init__(s,w,h): s.w,s.h=w,h; s.o=[]
    def box(s,x,y,w,h,title,sub=None,accent=False,small=False,fill=None,dash=False):
        f=fill or (BR50 if accent else CREAM); st=BR if accent else BORD
        s.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{f}" stroke="{st}" stroke-width="{2 if accent else 1.5}"{" stroke-dasharray=\"6 4\"" if dash else ""}/>')
        ts=15 if small else 17; cy=y+h/2
        lines=title if isinstance(title,list) else [title]
        subs=[] if not sub else (sub if isinstance(sub,list) else [sub])
        total=len(lines)*(ts+4)+len(subs)*17+(6 if subs else 0)
        yy=cy-total/2+ts
        for l in lines:
            s.o.append(f'<text x="{x+w/2}" y="{yy:.0f}" text-anchor="middle" font-size="{ts}" font-weight="700" fill="{INK}">{e(l)}</text>'); yy+=ts+4
        yy+=2
        for l in subs:
            s.o.append(f'<text x="{x+w/2}" y="{yy:.0f}" text-anchor="middle" font-size="13" fill="{MUTE}">{e(l)}</text>'); yy+=17
        return s
    def label(s,x,y,text,size=13,anchor='start',color=MUTE,bold=False):
        s.o.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" fill="{color}"{" font-weight=\"700\"" if bold else ""}>{e(text)}</text>'); return s
    def arrow(s,x1,y1,x2,y2,text=None,both=False,dash=False,tpos=0.5,tdy=-8,color=None):
        c=color or MUTE
        s.o.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c}" stroke-width="1.8" marker-end="url(#ah)"{" marker-start=\"url(#ahs)\"" if both else ""}{" stroke-dasharray=\"6 5\"" if dash else ""}/>')
        if text:
            tx=x1+(x2-x1)*tpos; ty=y1+(y2-y1)*tpos+tdy
            s.o.append(f'<text x="{tx:.0f}" y="{ty:.0f}" text-anchor="middle" font-size="12.5" fill="{MUTE}" style="paint-order:stroke" stroke="#fff" stroke-width="4">{e(text)}</text>')
        return s
    def group(s,x,y,w,h,title):
        s.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="#fff" stroke="{BR}" stroke-width="2"/>')
        s.o.append(f'<text x="{x+16}" y="{y+26}" font-size="17" font-weight="800" fill="{BR}">{e(title)}</text>'); return s
    def lane(s,x,text):
        s.o.append(f'<text x="{x}" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="{INK}">{e(text)}</text><line x1="{x}" y1="38" x2="{x}" y2="{s.h-10}" stroke="{LINE}" stroke-width="1.2"/>'); return s
    def msg(s,x1,x2,y,text,dash=False):
        s.o.append(f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{MUTE}" stroke-width="1.8" marker-end="url(#ah)"{" stroke-dasharray=\"6 5\"" if dash else ""}/>')
        s.o.append(f'<text x="{(x1+x2)/2:.0f}" y="{y-7}" text-anchor="middle" font-size="13" fill="{INK}" style="paint-order:stroke" stroke="#fff" stroke-width="5">{e(text)}</text>'); return s
    def note(s,x,y,w,text):
        s.o.append(f'<text x="{x}" y="{y}" font-size="12.5" fill="{BR}" font-style="italic">{e(text)}</text>'); return s
    def svg(s):
        return (f'<svg viewBox="0 0 {s.w} {s.h}" xmlns="http://www.w3.org/2000/svg" font-family="Inter, Liberation Sans, sans-serif">'
                f'<defs><marker id="ah" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{MUTE}"/></marker>'
                f'<marker id="ahs" markerWidth="10" markerHeight="10" refX="1" refY="5" orient="auto"><path d="M10,0 L0,5 L10,10 z" fill="{MUTE}"/></marker></defs>'+''.join(s.o)+'</svg>')
