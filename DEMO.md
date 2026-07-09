# BELTrak Demo Script (20 minutes)

## Pre-flight
- [ ] Login as **System Administrator** (full access)
- [ ] Simulator → "Reset to seed" → confirm
- [ ] Verify: red alarm banner + amber degraded banner visible

---

## Act 1 — The System (3 min)
- [ ] Dashboard → KPIs show seed state, charts are live
- [ ] Map → 4 suspect bags visible, reader overlay from store
- [ ] Readers → 12 readers, KPIs live (Online/Degraded/Offline)
- [ ] Settings → Users, Roles, Escalations all editable (CRUD)

## Act 2 — Flag & Tag (3 min)
- [ ] Simulator → "Flag Suspect Bag" → toast appears
- [ ] Tagging Station → bag in queue → select → "Print & Encode Tag"
- [ ] Wait 1.5s → if fail: "Re-encode" (shows verify-after-write safety)
- [ ] Success → bag in "Recently Tagged" with EPC
- [ ] Dashboard KPIs update: "Bags Tagged" +1

## Act 3 — Track & Alarm (3 min)
- [ ] Simulator → select the tagged bag
- [ ] "Journey A — Reclaim → Hall → Exit" → watch 2s per zone
- [ ] Red alarm toast fires at exit gate
- [ ] Red alarm banner count increments
- [ ] Map → bag dot at exit gate (red)
- [ ] Alarms → new row (ACTIVE)

## Act 4 — Respond & Resolve (3 min)
- [ ] Alarms → click Acknowledge → officer name shows (real session name)
- [ ] Alarm banner count drops
- [ ] Click View (eye icon) → navigates to Target Information
- [ ] Target → bag details, movement timeline, imagery placeholders
- [ ] Add officer note → appears with timestamp
- [ ] Recheck Station → bag visible → click "Cleared"
- [ ] Green toast → bag resolved
- [ ] Dashboard → "Bags Cleared" +1, pie chart updates

## Act 5 — Suppression & Edge Cases (3 min)
- [ ] Simulator → same bag → click "Exit Gate 1"
- [ ] Toast: "suppressed" — no second alarm (already cleared)
- [ ] "Burst 15 reads" → dedup: 14 merged, 1 new
- [ ] "Foreign EPC read" → discarded (unregistered tag)
- [ ] Toggle 3 readers offline → amber banner updates
- [ ] Readers page → KPIs reflect offline count
- [ ] Toggle back online → banner disappears

## Act 6 — Restricted Zone (2 min)
- [ ] Flag + tag a second bag
- [ ] Simulator → "Journey C — Reclaim → Employee Exit → Emergency"
- [ ] ESCAPE ALERT banner pulses red
- [ ] Alarms → escalated alarm visible
- [ ] Resolve → "Prohibited Item Seized"

## Act 7 — Compliance & Reports (2 min)
- [ ] Reports → click "Daily Activity" → real stats panel
- [ ] Click "Alarm Analytics" → zone breakdown
- [ ] Charts: Top Locations, Reader Ranking, Heatmap — all live
- [ ] Export CSV → file downloads with bags + alarms + events
- [ ] Target → "Print report" → clean print preview
- [ ] Settings → Audit Log → every action logged with timestamps
- [ ] Export audit CSV

## Act 8 — Persistence & Multi-User (1 min)
- [ ] Hard refresh browser → all data survives
- [ ] Open second tab → acknowledge alarm in tab 1 → tab 2 updates

## Act 9 — Role Demo (1 min)
- [ ] Logout → login as **Operations Officer**
- [ ] Sidebar: Settings + Simulator hidden
- [ ] Navigate to /simulator via URL → "Access Denied"
- [ ] Can still: acknowledge alarms, run recheck, view reports

## Closing
- [ ] Simulator → "Reset to seed" → clean for next demo
- [ ] Show: "This runs entirely on one laptop with simulated inputs.
       Real BHS + RFID reader integration is the next phase."

---

## Quick reset between demos
1. Login as System Administrator
2. Simulator → "Reset to seed" → Confirm
3. Verify banners reappear → ready

## Offline resilience
- App works offline (optimistic store)
- Gray "You are offline" banner appears
- Data syncs when connection restored