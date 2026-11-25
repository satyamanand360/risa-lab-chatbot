"""Export the RISA attendee dataset into cleaned JSON seed files.
Only exact duplicate source IDs are removed here; every other rule (person type,
verification, as-of history) is applied at query time so the raw facts stay intact."""
import json, sys, pandas as pd
src = sys.argv[1]; out = sys.argv[2]
x = pd.read_excel(src, sheet_name=None)
def ts(v):
    if pd.isna(v): return None
    return pd.Timestamp(v).strftime('%Y-%m-%dT%H:%M:%S') + '+05:30'
def d(v):
    return None if pd.isna(v) else pd.Timestamp(v).strftime('%Y-%m-%d')
report = {}
def dedupe(df, key, name):
    before = len(df); df = df.drop_duplicates(); 
    dup_ids = df[key].duplicated().sum()
    assert dup_ids == 0, f"{name}: {dup_ids} non-identical rows share an id"
    report[name] = {"rows_in_source": before, "exact_duplicates_removed": before - len(df), "rows_kept": len(df)}
    return df
c = x['Campaigns']
campaigns = [dict(id=r.campaign_id, name=r.campaign_name, channel=r.channel, audience=r.target_audience, objective=r.objective,
  owner_id=r.owner_id, owner_name=r.owner_name, created_at=ts(r.created_at), planned_start=ts(r.planned_start_at), planned_end=ts(r.planned_end_at)) for r in c.itertuples()]
dm = dedupe(x['Daily Marketing'], 'activity_id', 'daily_marketing')
daily = [dict(activity_id=r.activity_id, campaign_id=r.campaign_id, activity_date=d(r.activity_date), impressions=int(r.impressions), clicks=int(r.clicks),
  reported_reach=int(r.reported_reach), sessions=int(r.landing_page_sessions), registration_starts=int(r.registration_starts), spend_inr=int(r.marketing_spend_inr), platform=r.platform) for r in dm.itertuples()]
p = dedupe(x['People'], 'person_id', 'people')
people = [dict(person_id=r.person_id, person_name=r.person_name, person_type=r.person_type, first_seen_at=ts(r.first_seen_at), first_touch_source=r.first_touch_source,
  first_campaign_id=None if pd.isna(r.first_campaign_id) else r.first_campaign_id) for r in p.itertuples()]
ie = dedupe(x['Interest and Engagement'], 'interaction_id', 'interactions')
inter = [dict(interaction_id=r.interaction_id, person_id=r.person_id, campaign_id=None if pd.isna(r.campaign_id) else r.campaign_id, occurred_at=ts(r.occurred_at), event_type=r.event_type) for r in ie.itertuples()]
rg = dedupe(x['Registrations'], 'registration_id', 'registrations')
regs = [dict(registration_id=r.registration_id, person_id=r.person_id, campaign_id=None if pd.isna(r.campaign_id) else r.campaign_id, registered_at=ts(r.registered_at)) for r in rg.itertuples()]
rh = dedupe(x['Registration History'], 'history_id', 'registration_history')
hist = [dict(history_id=r.history_id, registration_id=r.registration_id, effective_at=ts(r.effective_at), status=r.status) for r in rh.itertuples()]
ck = dedupe(x['Check-ins'], 'event_id', 'checkins')
chk = [dict(event_id=r.event_id, person_id=r.person_id, registration_id=None if pd.isna(r.registration_id) else r.registration_id,
  campaign_id=None if pd.isna(r.campaign_id) else r.campaign_id, occurred_at=ts(r.occurred_at), result=r.result, verification=r.verification, source=r.source) for r in ck.itertuples()]
t = x['Targets']
targets = [dict(effective_at=ts(r.effective_at), version=r.target_version, people_goal=int(r.identified_external_people_goal), registration_goal=int(r.registration_goal),
  visitor_goal=int(r.unique_external_visitors_goal), budget_inr=int(r.marketing_budget_inr)) for r in t.itertuples()]
ev = x['Event'].iloc[0]
event = dict(name=ev.event_name, history_start=d(ev.history_start), history_end=d(ev.history_end), starts_at=ts(ev.event_starts_at), ends_at=ts(ev.event_ends_at))
seed = dict(event=event, targets=targets, campaigns=campaigns, daily=daily, people=people, interactions=inter, registrations=regs, history=hist, checkins=chk, quality=report)
json.dump(seed, open(out,'w'))
print(json.dumps(report, indent=1)); print({k: len(v) for k,v in seed.items() if isinstance(v,list)})
