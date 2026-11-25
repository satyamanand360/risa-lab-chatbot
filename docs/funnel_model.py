import json
el={'Organic Search':(14,195,250),'Community Groups':(16,165,200),'Campus Ambassadors':(42,390,520),'Paid Social':(93,340,680),'Creator Partners':(59,175,350)}
E={'Organic Search':0.85,'Community Groups':0.85,'Campus Ambassadors':0.85,'Paid Social':0.6,'Creator Partners':0.6}
BASE_SHOW=0.758
res={}
def run(name,approach,sign,grp,ccost_per,ref_rate,ref_cost,show,walk,alloc,engine):
    out={}
    signed=approach*sign; cregs=signed*grp; catt=cregs*0.86; ccost=signed*ccost_per+15
    out['College Partnerships']=[ccost,cregs,catt]
    for c,(s,a,r) in el.items():
        if alloc[c]<=0: out[c]=[0,0,0];continue
        k=(alloc[c]/s)**E[c]; out[c]=[alloc[c],r*k,a*k]
    nonref=sum(v[1] for v in out.values())
    rregs=nonref*ref_rate; ratt=rregs*0.79; out['Student Referrals']=[ratt*ref_cost/1000+7,rregs,ratt]
    m=show/BASE_SHOW
    for v in out.values(): v[2]*=m
    regs=sum(v[1] for v in out.values()); att=sum(v[2] for v in out.values())
    spend=sum(v[0] for v in out.values())+engine
    tot=att+walk
    print(f"== {name}: spend {spend:.0f}k regs {regs:.0f} reg-attendees {att:.0f} walk {walk} TOTAL {tot:.0f} cost/att {spend*1000/tot:.0f}")
    for c,v in out.items(): print(f"  {c:22s} {v[0]:5.1f}k regs {v[1]:5.0f} att {v[2]:5.0f} cpa {v[0]*1000/max(v[2],1):4.0f}")
    res[name]=dict(spend=spend,regs=regs,tot=tot,ch=out)
run('base',150,0.30,22,1.5,0.18,100,0.80,125,{'Organic Search':15,'Community Groups':20,'Campus Ambassadors':50,'Paid Social':35,'Creator Partners':0},20)
run('stretch',200,0.35,25,1.2,0.28,90,0.85,300,{'Organic Search':15,'Community Groups':20,'Campus Ambassadors':45,'Paid Social':20,'Creator Partners':0},20)
json.dump(res,open('model.json','w'),indent=1)
