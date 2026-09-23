import re,subprocess,sys
html,pdf=sys.argv[1],sys.argv[2]
def render(): subprocess.run(["node","render.mjs",html,pdf],check=True,capture_output=True)
render()
n=int(re.search(r'Pages:\s+(\d+)',subprocess.run(["pdfinfo",pdf],capture_output=True,text=True).stdout).group(1))
s=open(html).read()
titles=re.findall(r'<div class="section-hd"><span class="num">(\d+)</span><h2>(.*?)</h2>',s)
def norm(t): return re.sub(r'\s+',' ',re.sub(r'<[^>]+>','',t).replace('&amp;','&')).strip()
pages={}
for i in range(3,n+1):
    txt=subprocess.run(["pdftotext","-f",str(i),"-l",str(i),pdf,"-"],capture_output=True,text=True).stdout
    flat=re.sub(r'\s+',' ',txt)
    for num,t in titles:
        key=f"{num} {norm(t)}"
        if num not in pages and key in flat: pages[num]=i
toc=re.findall(r'(<li><span>)(.*?)(</span><span class="pg">)(\d+)(</span></li>)',s)
out=s
for k,(num,t) in enumerate(titles):
    pg=pages.get(num)
    if pg and k<len(toc):
        a,b,c,d,e=toc[k]; out=out.replace(a+b+c+d+e,a+b+c+str(pg)+e,1)
open(html,'w').write(out); render()
print("pages",n,pages)
