"""SVG diagram DSL v2: auto-wrapped text that always fits its box, arrows that
stop at box edges, big type (titles 18px, body 14px on a 760-wide canvas)."""
from html import escape as e
import sys
BR='#E47127'; INK='#0A0A0A'; MUTE='#4A4A4A'; LINE='#B9B9B9'; CREAM='#FAF7F2'; BORD='#CFC8BC'; BR50='#FEF3EC'
def _wrap(text,size,maxw):
    cw=size*0.52; words=text.split(); lines=[]; cur=''
    for w in words:
        t=(cur+' '+w).strip()
        if len(t)*cw<=maxw or not cur: cur=t
        else: lines.append(cur); cur=w
    if cur: lines.append(cur)
    return lines
class D:
    def __init__(s,w,h): s.w,s.h=w,h; s.o=[]; s.boxes={}
    def box(s,key,x,y,w,h,title,sub=None,accent=False,ts=18,ss=14):
        f=BR50 if accent else CREAM; st=BR if accent else BORD
        tl=[]; 
        for t in (title if isinstance(title,list) else [title]): tl+=_wrap(t,ts,w-22)
        sl=[]
        for t in ([] if not sub else (sub if isinstance(sub,list) else [sub])): sl+=_wrap(t,ss,w-22)
        need=len(tl)*(ts+4)+len(sl)*(ss+4)+(8 if sl else 0)+18
        if need>h: print(f"[diag] box '{key}' needs {need}px, has {h}px",file=sys.stderr); h=need
        s.boxes[key]=(x,y,w,h)
        s.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{f}" stroke="{st}" stroke-width="{2.2 if accent else 1.6}"/>')
        total=len(tl)*(ts+4)+len(sl)*(ss+4)+(8 if sl else 0); yy=y+h/2-total/2+ts-2
        for l in tl: s.o.append(f'<text x="{x+w/2}" y="{yy:.0f}" text-anchor="middle" font-size="{ts}" font-weight="700" fill="{INK}">{e(l)}</text>'); yy+=ts+4
        yy+=6
        for l in sl: s.o.append(f'<text x="{x+w/2}" y="{yy:.0f}" text-anchor="middle" font-size="{ss}" fill="{MUTE}">{e(l)}</text>'); yy+=ss+4
        return s
    def link(s,a,b,text=None,both=False,dash=False,side=None):
        ax,ay,aw,ah=s.boxes[a]; bx,by,bw,bh=s.boxes[b]
        acx,acy,bcx,bcy=ax+aw/2,ay+ah/2,bx+bw/2,by+bh/2
        dx,dy=bcx-acx,bcy-acy
        horizontal = side=='h' or (side is None and abs(dx)*ah>abs(dy)*aw)
        if horizontal:
            if dx>0: x1,y1,x2,y2=ax+aw,acy,bx,bcy
            else:    x1,y1,x2,y2=ax,acy,bx+bw,bcy
            if abs(y1-y2)>2:  # orthogonal elbow
                mx=(x1+x2)/2; pts=f'{x1},{y1} {mx},{y1} {mx},{y2} {x2},{y2}'
                s.o.append(f'<polyline points="{pts}" fill="none" stroke="{MUTE}" stroke-width="2" marker-end="url(#ah)"{" marker-start=\"url(#ahs)\"" if both else ""}{" stroke-dasharray=\"7 5\"" if dash else ""}/>')
                tx,ty=mx,(y1+y2)/2
            else:
                s.o.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{MUTE}" stroke-width="2" marker-end="url(#ah)"{" marker-start=\"url(#ahs)\"" if both else ""}{" stroke-dasharray=\"7 5\"" if dash else ""}/>')
                tx,ty=(x1+x2)/2,y1-9
        else:
            if dy>0: x1,y1,x2,y2=acx,ay+ah,bcx,by
            else:    x1,y1,x2,y2=acx,ay,bcx,by+bh
            if abs(x1-x2)>2:
                my=(y1+y2)/2; pts=f'{x1},{y1} {x1},{my} {x2},{my} {x2},{y2}'
                s.o.append(f'<polyline points="{pts}" fill="none" stroke="{MUTE}" stroke-width="2" marker-end="url(#ah)"{" marker-start=\"url(#ahs)\"" if both else ""}{" stroke-dasharray=\"7 5\"" if dash else ""}/>')
                tx,ty=(x1+x2)/2,my-9
            else:
                s.o.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{MUTE}" stroke-width="2" marker-end="url(#ah)"{" marker-start=\"url(#ahs)\"" if both else ""}{" stroke-dasharray=\"7 5\"" if dash else ""}/>')
                tx,ty=x1+10,(y1+y2)/2+5
        if text: s.o.append(f'<text x="{tx:.0f}" y="{ty:.0f}" text-anchor="middle" font-size="13.5" fill="{MUTE}" style="paint-order:stroke" stroke="#fff" stroke-width="6">{e(text)}</text>')
        return s
    def group(s,x,y,w,h,title):
        s.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="#fff" stroke="{BR}" stroke-width="2.2"/>')
        s.o.append(f'<text x="{x+18}" y="{y+30}" font-size="19" font-weight="800" fill="{BR}">{e(title)}</text>'); return s
    def text(s,x,y,t,size=14,anchor='middle',color=MUTE,bold=False,italic=False):
        s.o.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" fill="{color}"{" font-weight=\"700\"" if bold else ""}{" font-style=\"italic\"" if italic else ""}>{e(t)}</text>'); return s
    def lane(s,x,t,bottom):
        s.o.append(f'<text x="{x}" y="28" text-anchor="middle" font-size="16" font-weight="700" fill="{INK}">{e(t)}</text><line x1="{x}" y1="42" x2="{x}" y2="{bottom}" stroke="{LINE}" stroke-width="1.4"/>'); return s
    def msg(s,x1,x2,y,t,dash=False):
        s.o.append(f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{MUTE}" stroke-width="2" marker-end="url(#ah)"{" stroke-dasharray=\"7 5\"" if dash else ""}/>')
        s.o.append(f'<text x="{(x1+x2)/2:.0f}" y="{y-8}" text-anchor="middle" font-size="14" fill="{INK}" style="paint-order:stroke" stroke="#fff" stroke-width="6">{e(t)}</text>'); return s
    def svg(s):
        return (f'<svg viewBox="0 0 {s.w} {s.h}" xmlns="http://www.w3.org/2000/svg" font-family="Inter, Liberation Sans, sans-serif">'
                f'<defs><marker id="ah" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L9,4.5 L0,9 z" fill="{MUTE}"/></marker>'
                f'<marker id="ahs" markerWidth="9" markerHeight="9" refX="1" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M9,0 L0,4.5 L9,9 z" fill="{MUTE}"/></marker></defs>'+''.join(s.o)+'</svg>')
